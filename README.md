# specimen-box-server

「標本箱」アプリ（`specimen-box`）のバックエンド。**問いの配信**と**ランダムな標本画像の配信**を行う、
薄い読み取り専用 API。

## 技術スタック
- **API**: [Hono](https://hono.dev/)（TypeScript）on **Cloudflare Workers**
- **画像配信**: Cloudflare **R2 ＋ CDN**（egress 無料 → コストが利用者数に比例しない）
- **問いプール**: R2 のバージョン付き JSON（未設定時は同梱 `src/data/questions.v1.json` にフォールバック）

設計判断はすべて ADR（`~/Project-Obsidian/specimen-box-server/ADR/`）に記録:
ADR-0002（スタック/インフラ）/ ADR-0003（画像生成）/ ADR-0004（API契約）/ ADR-0005（識別・レート制限）/ ADR-0006（問い）。

## API（v1）
すべて最小情報のみ送る（回答本文・個人情報は送らない）。任意ヘッダ: `X-Device-Token`（レート制限の鍵）, `X-App-Key`（APP_API_KEY 設定時）。

### `POST /v1/questions/next`
```jsonc
// req
{ "recent": ["q-sound-01"], "localTime": "2026-06-12T23:40:00+09:00" }
// res
{ "question": { "id": "q-sound-01", "text": "…", "category": "sound", "condition": null }, "broadcast": false }
```
サーバーは個人状態を持たず、`recent`（直近問いID窓）で反復回避・カテゴリ偏り回避を行う。一斉配信が有効な期間は `broadcast: true`。

### `POST /v1/images/draw`
```jsonc
// req: owned = 端末が所有する image_id 群（除外集合）
{ "owned": ["000001", "000042"] }
// res
{ "image": { "id": "001234", "url": "https://cdn…/img/001234.webp", "name": "怒った扇風機", "format": "webp", "width": 768, "height": 768, "rarity": 5 }, "exhausted": false }
```
`image_id` は `[0, N)` の連番。総数 N からランダムに引き、`owned` に当たれば引き直す（ステートレスな一意ランダム配信）。
全所有済みなら `{ "image": null, "exhausted": true }`。

`rarity` は標本のレア度（1=★1 〜 5=★5）。各標本の不変・固有プロパティで、生成時にクォータ配分で確定し見た目にも反映される（ADR-0009、旧 ADR-0008 を Supersede）。
抽選は一様ランダムのまま（レア度で歪めない）なので、プール構成比＝排出率。割合は ★1:50% / ★2:30% / ★3:14% / ★4:5% / ★5:1%（★5 はかなりレア）。

`name` は標本の表示名（日本語・例「怒った扇風機」/ ADR-0010）。レア度と同じく生成時に被写体から確定し、`image_id`・URL とワンセットで返る。

### `GET /health` → `{ "ok": true }`

## 開発
```bash
npm install
npm run typecheck
npm test            # 純粋ロジックのユニットテスト（vitest）
npm run dev         # wrangler dev（ローカル）
```
ローカル設定: `.dev.vars.example` を `.dev.vars` にコピー。公開変数は `wrangler.jsonc` の `vars`。

### ローカルE2E疎通手順

D1・R2 はすべて wrangler/miniflare のローカルストレージ（`.wrangler/state/`）を使う。本番クレデンシャル不要。

**base URL**: `http://localhost:8787`

```bash
# 1. ダミー画像生成 + D1 migrations + R2 画像投入 + D1 seed（ワンコマンド・冪等）
npm run seed:local

# 2. wrangler dev を起動（別ターミナルで常駐させる）
npm run dev

# 3. 別ターミナルで疎通スクリプト実行
bash scripts/smoke.sh
```

疎通スクリプト（`scripts/smoke.sh`）は以下を検証します。
1. `POST /v1/questions/next` — question が返ること
2. `POST /v1/images/draw` — image.url が返ること
3. その URL (`/dev/img/...`) から画像バイト（200 + image/png）が取得できること

**クライアント接続**:
- **iOS シミュレータ**: `http://localhost:8787` で疎通可能（ホストと同一ネットワーク）
- **iOS 実機**: 母艦の LAN IP を使用（例: `http://192.168.1.x:8787`）。`.dev.vars` に `IMAGE_CDN_BASE=http://<母艦IP>:8787/dev/img` を設定する
- **CORS**: ブラウザ外クライアント（Flutter モバイル）は不要。Flutter Web のみ CORS 設定が必要

**dev 画像配信ルート** (`GET /dev/img/<r2_key>`):
- `ENVIRONMENT=production` では自動的に 404 を返す（本番フローに影響しない）
- ローカル起動時は `IMAGE_CDN_BASE=http://localhost:8787/dev/img` を `.dev.vars` に設定すると、`/v1/images/draw` が返す URL が dev ルートを指すようになる

## デプロイ
1. R2 バケット（画像 `IMAGES` / 問い `QUESTIONS`）と KV（`RATE_LIMIT`）を作成し、`wrangler.jsonc` のバインディングを有効化。
2. `IMAGE_CDN_BASE` / `IMAGE_POOL_COUNT` を実値に更新。`APP_API_KEY` は `wrangler secret put` で設定（任意）。
3. `npm run deploy`。

## 構成
```
src/
  index.ts            # Hono アプリ（/v1 配線・エラー処理）
  middleware.ts       # APP_API_KEY ガード・レート制限
  routes/             # questions.ts / images.ts（bindings 配線）
  lib/                # 純粋ロジック（テスト対象）: questions / images / time / rateLimit / loadQuestions
  schema.ts           # zod リクエスト検証
  types.ts            # API 契約・ドメイン型
  data/questions.v1.json
test/                 # vitest（純粋関数の単体テスト）
```
