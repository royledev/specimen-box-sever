# 標本プール生成パイプライン（レンタルGPU）

シュール/不条理な「標本」イラストを画像生成AIで量産する手順とスクリプト。
設計の真実の源は ADR-0011（被写体・表示名＝キュレーション済みワードリスト）/ ADR-0009（レア度を生成時に確定し見た目へ反映）/
ADR-0003（スタイル・解像度・再現性）。プロンプト仕様は Project-Obsidian の `画像生成プロンプト` ノート（§ワードリスト・§レア度別ビジュアル含む）。

## 構成
| ファイル | 役割 |
| --- | --- |
| `names.json` | **真実の源**。`{name(日本語表示名), prompt_en(英語被写体プロンプト)}` のキュレーション済みリスト（ADR-0011・目標1000件）。 |
| `generate.py` | names.json を読み、**FLUX.1 [schnell]** で被写体（化石・石彫り風・人間なし）を生成。**レア度エフェクトを標本自体に焼き込み**（Lv1〜5）。白背景生成→**rembg で透過化して透過 RGBA を直接出力**（`--no-matte` で無効）。マニフェスト出力。 |
| `postprocess.py` | 1024px 透過PNG（中間） → 768px **透過 WebP ロスレス**・pHash 近似重複排除・idx 振り直し・bytes 記録（**alpha 保持**）。 |
| `matting.py` | 背景透過（rembg）の共有ヘルパー。`generate.py`（生成時統合）と `remove_bg.py` が利用。 |
| `remove_bg.py` | 【任意】**既に白背景で生成済み**の画像を後から透過化する単体ツール（旧プール再処理用）。通常は generate.py が透過するため不要。 |
| `gen-import-sql.mjs` | マニフェスト → 本番 images シード `seeds/prod/images.sql`（DELETE なし INSERT）。`tools/gen-seed.mjs` と同じ厳格検証。 |
| `requirements.txt` | Python 依存（生成＋透過化 rembg/onnxruntime-gpu）。 |

## ワードリスト（names.json / ADR-0011）
被写体と表示名はすべて `names.json` 由来。1件 = `{ "name": "怒った扇風機", "prompt_en": "an angry electric fan ..." }`。
- `name` がそのまま標本の表示名（`images.name`）になり、`prompt_en` が画像生成プロンプトの被写体になる。
- 量産は `画像生成プロンプト` ノート §ワードリスト量産 の LLM メタプロンプトで `{name, prompt_en}` を作り、人がキュレーション。
- ルール: `name` は 1〜80 文字・一意・制御文字なし、`prompt_en` は非空。CI（`test/seedIntegrity.test.ts`）で形式と一意を検証。
- ローカルE2E用ダミー16枚（`tools/gen-dummy-images.mjs`）も names.json 先頭16件の `name` を使う（真実の源を一本化）。

レア度クォータ（`allocate_rarities` / 最大剰余法）は `tools/rarity.mjs`・`src/lib/rarity.ts` と同一ロジック。**変更時は3箇所を揃える**。300枚なら ★1:150 / ★2:90 / ★3:42 / ★4:15 / ★5:3。

## 手順（300枚の例）

### 1. RunPod で GPU を借りる
- Deploy → GPU Pod。GPU は RTX 4090（安価）か A100（速い）。テンプレートは「RunPod PyTorch 2.x」。
- 接続後、依存を入れる:
  ```bash
  pip install -U -r requirements.txt
  huggingface-cli login   # FLUX.1 [schnell] は HF 上でライセンス同意が必要（または export HF_TOKEN=...）
  ```

### 2. 生成（FLUX.1 [schnell]）
```bash
python generate.py --count 300 --out out --manifest manifest.json
# out/<uuid>.png ×300（中間・透過RGBA PNG）と manifest.json（image_id/idx/rarity/name/seed/model/prompt）が出る
# 化石・石彫り風キャラ＋レア度エフェクトを標本自体に焼き込み（Lv1=無地 … Lv5=金色に強く発光）。
# 白背景で生成し rembg で切り抜いて**透過RGBAを直接出力**（既定ON。冒頭ログで matte の GPU/CPU を表示。--no-matte で白背景のまま）。
```
> **VRAM について**: FLUX.1 は約12B params（bf16で~24GB）。`generate.py` は**既定で GPU に全載せ**（オフロード無効）＝
> 大容量GPU（VRAM 62GB 等）で最速。`pipe.to("cuda")` のみで VAE 分割/タイルも使わない。
> VRAM が ~24GB 以下で OOM する小容量GPUのときだけ `--offload` を付ける（`enable_model_cpu_offload` + VAE slicing/tiling・低速）。
> 断片化で溢れる場合は環境変数を付けて再実行:
> ```bash
> PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True python generate.py --count 300 ...
> ```
> schnell は `--steps 4 --guidance 0`（既定）。guidance/negative は効かないので、表現はプロンプト語で調整する。

### 3. 後処理（透過 WebP 化・重複排除）
```bash
python postprocess.py --in out --webp webp --manifest manifest.json --threshold 5
# webp/<uuid>.webp（768px・透過保持）と、kept 件で更新された manifest.json
```
- 入力は generate.py の**透過 RGBA**。postprocess も **alpha を保持**してリサイズ・WebP 保存する。
- レア度エフェクトは **generate.py で標本自体に焼き込み済み**（Lv1〜5）。後処理では合成しない。
- 出力は **透過 WebP ロスレス**（2026-06-16 ユーザー方針・端末容量配慮）。劣化なしで PNG より小さく、iPhone/Flutter で表示可。
  さらに容量を詰めたい場合は `--quality 90` 等でロスシー WebP に切替（既定 `--quality 100`=ロスレス）。
- 重複除去で 300 を下回ったら、`names.json` のワードを使って（ADR-0011・1000件あり）`--count` 分を再生成する。
  `generate.py` は names.json の件数 < `--count` ならエラーで止まる（不足を黙って切り詰めない）。

> 透過は generate.py に統合済み（白背景生成→rembg 切り抜き）。**既に白背景で生成済みの旧画像**を後から透過化したいときだけ
> `python remove_bg.py --in <白背景webp> --out webp_transparent --manifest manifest.json` を使う（任意）。

### 4. 成果物を取得して R2 へ投入
```bash
# ローカルへ webp/（透過済み）と manifest.json を回収（runpodctl / scp）してから:
cd webp
for f in *.webp; do
  npx wrangler r2 object put "specimen-box-images/img/$f" --file "$f" --remote
done
# 大量なら rclone / aws s3（R2 のS3互換エンドポイント）で一括の方が速い
```

### 5. D1 にメタ投入（migration は schema 専用。images は seed コマンドで投入）
```bash
node tools/generate/gen-import-sql.mjs manifest.json   # → seeds/prod/images.sql を生成（既定出力）
npm run migrate:prod                                   # schema を適用（0003=rarity 列 / 0004=name 列を含む）
npm run seed:prod:images                               # = wrangler d1 execute ... --file=seeds/prod/images.sql -c wrangler.prod.jsonc
```
> `seeds/prod/images.sql` は `rarity`・`name` 列に INSERT するため、schema migration（0003=rarity / 0004=name）が remote に適用済みであること。
> `migrate:prod` は未適用分をまとめて当てるので、初回はこれ1回で 0001〜0005 が揃う（migration は schema のみ＝seed は入らない）。
> questions も本番に入れるなら `npm run seed:prod`（questions＋images）または `npm run seed:prod:questions`。

## 再現性（ADR-0003 決定5）
各画像の `seed`・`model`・`prompt`・`rarity`・`name` をマニフェストに記録する。ワードリストのシャッフル・生成 seed・
キラキラ合成（image_id シード）はすべて固定なので、同じ `names.json`・モデルなら同一プールを再生成できる。

## レア度エフェクトの方針（ADR-0009 / 2026-06-16）
レア度エフェクトは **generate.py のプロンプトで標本自体に焼き込む**（Lv1〜5）。キャラ（被写体）は共通で、
末尾の `RARITY_EFFECT[lv]` だけがレア度で変わる（Lv1=無地 → **Lv3=しっかり発光 / Lv4=発光＋箔 / Lv5=金色に強く発光**）。
生成後に `remove_bg.py` で白背景を透過化するが、**本体に焼き込んだ演出は残る**。文言は `generate.py` の `RARITY_EFFECT` と
`画像生成プロンプト` ノート §レア度別ビジュアルで一致管理。

## ローカルのダミー16枚との違い
ローカルE2E用のダミーは `tools/gen-dummy-images.mjs`（pngjs・GPU不要）。本パイプラインは実プール用。
どちらもマニフェストに `rarity` を持ち、seed/import がそれを信頼する点は同じ（ADR-0009）。
