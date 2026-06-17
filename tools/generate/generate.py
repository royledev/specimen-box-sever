#!/usr/bin/env python3
"""標本プール生成（レンタルGPU・FLUX.1 [schnell] / ADR-0011・ADR-0009）。

- 被写体・表示名の真実の源は **キュレーション済みワードリスト** tools/generate/names.json（ADR-0011）。
  各件 {name(日本語表示名), prompt_en(英語被写体プロンプト)}。name はそのまま images.name に、
  prompt_en は画像生成プロンプトの被写体になる（旧 ADR-0003 のオブジェクト×行為の組み合わせ生成は廃止）。
- 生成モデルは **FLUX.1 [schnell]**（Apache-2.0・商用配布可 / ADR-0003）。schnell は guidance 無効・negative 非対応。
  ※ FLUX.1 [dev] は非商用ライセンスのため不可。
- キャラは化石・石彫り風で固定。**レア度エフェクトはプロンプトで付与**（Lv1〜5 / ADR-0009）。
  発光・箔・金は**標本自体に焼き込む**（Lv1=無地 … Lv5=金色に強く発光）。
- **透過出力**: FLUX は alpha を直接出せないため、白背景で生成 → 生成直後に rembg（matting.py）で**白背景を切り抜いて透過 RGBA** にして出力（既定ON / `--no-matte` で白背景のまま）。
- レア度は「生成前に」クォータ配分で確定（ADR-0009 決定2）。
- 1枚ごとに image_id(UUID)・idx・rarity・name・seed・model・full prompt をマニフェストに記録する
  （ADR-0003 決定5 の再現性記録に rarity / ADR-0009 決定2 / ADR-0010 の name）。
- 出力は 1024px 透過 PNG（ロスレス中間・RGBA）。768px 透過 WebP 化・近似重複排除は postprocess.py が行う。

使い方:
    python generate.py --count 300 --out out --manifest manifest.json [--names names.json]

注意: RARITY_DISTRIBUTION と allocate_rarities は tools/rarity.mjs / src/lib/rarity.ts と
      同一ロジックでなければならない（最大剰余法・構成比）。変更時は両方を揃えること。
"""
import argparse
import json
import random
import uuid
from pathlib import Path

# --- レア度構成比（= 排出率）。tools/rarity.mjs と一致させる（ADR-0009 決定3） ---
RARITY_DISTRIBUTION = [(1, 0.50), (2, 0.30), (3, 0.14), (4, 0.05), (5, 0.01)]


def allocate_rarities(total: int) -> list[int]:
    """total 枚へレア度を最大剰余法でクォータ配分（レア度昇順）。tools/rarity.mjs と同一。"""
    if not isinstance(total, int) or total < 0:
        raise ValueError(f"total は 0 以上の整数が必要 (got {total})")
    tiers = []
    for rarity, weight in RARITY_DISTRIBUTION:
        exact = total * weight
        count = int(exact)  # floor（非負）
        tiers.append({"rarity": rarity, "count": count, "remainder": exact - count})
    leftover = total - sum(t["count"] for t in tiers)
    by_rem = sorted(tiers, key=lambda t: (-t["remainder"], t["rarity"]))
    for i in range(leftover):
        by_rem[i % len(by_rem)]["count"] += 1
    out = []
    for t in tiers:
        out.extend([t["rarity"]] * t["count"])
    return out


# --- キャラクター共通スタイル（画像生成プロンプト.md §1 / 一貫性の核） ---
# 化石・石彫り風（リアル写真禁止・人間禁止・文字禁止）。被写体を古代化石として石板に刻んだ見た目。
# 背景は付けず白背景に切り抜く（2026-06-16 ユーザー方針・参考画像）。発光等のレア度演出は RARITY_EFFECT 側。
CHARACTER_STYLE = (
    "depicted as an ancient fossil carved in stone, bas-relief carving embedded in a "
    "cracked weathered sandstone slab, monochrome sepia and earthy brown stone tones, "
    "bold thick clean black outlines, expressive exaggerated cartoon face, eroded rocky "
    "texture with cracks and chips, single centered subject, isolated on plain solid "
    "white background, no scenery, no written words, no captions"
)

# --- レア度エフェクト（ADR-0009 / 画像生成プロンプト.md §レア度別ビジュアル） ---
# レア度ごとに段階強化（2026-06-16 ユーザー指定）: Lv3=しっかり発光 / Lv4=発光＋箔を追加 / Lv5=金色に強く発光。
# 発光・箔・金は**標本（被写体）自体に焼き込む**（後段の remove_bg.py で白背景を抜いても標本側の演出は残る）。
# schnell は弱く出やすいので強調語を前置・反復する。※背景は白で生成（切り抜き用）・枠なし。
RARITY_EFFECT = {
    1: "flat lighting, matte finish, no special effects, plain white background",
    2: "silver rim light, glowing outline, faint sparkles, plain white background",
    3: "strong vivid glow, intense bright radiant luminous aura, brightly glowing light "
       "surrounding the subject, glossy sheen, diagonal lens flare, floating glowing "
       "sparkle particles, plain white background",
    4: "strong glowing aura, bright radiant glow, shiny holographic iridescent foil "
       "overlay, glossy metallic rainbow foil sheen on the surface, prismatic light rays, "
       "glowing crystal particles, plain white background",
    5: "intense brilliant golden glow, radiant glowing golden light aura, maximum luminous "
       "golden shine, glowing gold holographic foil, sparkling golden particles, flowing "
       "golden stardust, plain white background",
}

# 注: FLUX.1 [schnell] は negative_prompt 非対応（guidance 無効）。リアル化抑制・人間/文字除外は
#     CHARACTER_STYLE のポジティブ語（flat 2D vector, cartoon, no written words 等）で担保する。
#     CFG が効くモデル（SDXL 等）へ切り替える場合のみネガティブを使う（画像生成プロンプト.md §3 参照）。


def build_prompt(subject: str, rarity: int) -> str:
    """被写体＋キャラ共通スタイル＋レア度エフェクトを合成（レア度で発光・箔・金が変わる。背景は白→後段で透過化）。"""
    return f"{subject}, {CHARACTER_STYLE}, {RARITY_EFFECT[rarity]}"

# --- 被写体・表示名の真実の源: キュレーション済みワードリスト（ADR-0011） ---
# names.json = [{ "name": 日本語表示名, "prompt_en": 英語被写体プロンプト }, ...]
# name はそのまま images.name に、prompt_en は画像生成プロンプトの被写体になる。
DEFAULT_NAMES_PATH = Path(__file__).parent / "names.json"

NAME_MAX = 80   # tools/gen-import-sql.mjs / gen-seed.mjs の検証と揃える（ADR-0010 決定2）
SHUFFLE_SEED = 20260614   # ワードリストのシャッフル固定シード（再現性）
SEED_BASE = 1_000_000     # 画像生成シードのベース（seed = SEED_BASE + idx）


def load_names(names_path: Path) -> list[dict]:
    """names.json を読み、各件を検証して返す（name 重複は検出してエラー停止）。ADR-0011。"""
    data = json.loads(names_path.read_text(encoding="utf-8"))
    if not isinstance(data, list) or not data:
        raise ValueError(f"{names_path} は非空の配列である必要がある")
    seen, out = set(), []
    for i, row in enumerate(data):
        if not isinstance(row, dict):
            raise ValueError(f"names[{i}] がオブジェクトでない")
        name, prompt_en = row.get("name"), row.get("prompt_en")
        if not isinstance(name, str) or not (1 <= len(name) <= NAME_MAX):
            raise ValueError(f"names[{i}].name が空か長すぎる: {name!r}")
        if any(ord(c) < 0x20 or ord(c) == 0x7f for c in name):
            raise ValueError(f"names[{i}].name に制御文字: {name!r}")
        if not isinstance(prompt_en, str) or not prompt_en.strip():
            raise ValueError(f"names[{i}].prompt_en が空: name={name!r}")
        if any(ord(c) < 0x20 or ord(c) == 0x7f for c in prompt_en):
            raise ValueError(f"names[{i}].prompt_en に制御文字: name={name!r}")
        if name in seen:
            raise ValueError(f"names に重複名: {name!r}")
        seen.add(name)
        out.append({"name": name, "prompt_en": prompt_en.strip()})
    return out


def build_specs(count: int, names_path: Path) -> list[dict]:
    """ワードリストを決定論シャッフルして count 件返す（ADR-0011）。

    各要素は {"subject": prompt_en（英語・画像生成用）, "name": 日本語表示名}。
    """
    items = load_names(names_path)
    random.Random(SHUFFLE_SEED).shuffle(items)
    if count > len(items):
        raise ValueError(
            f"ワードリストが不足: {len(items)} 件 < count={count}。"
            f" tools/generate/names.json を増やすこと（ADR-0011 / 目標1000件）。"
        )
    return [{"subject": it["prompt_en"], "name": it["name"]} for it in items[:count]]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=300)
    ap.add_argument("--out", type=Path, default=Path("out"))
    ap.add_argument("--manifest", type=Path, default=Path("manifest.json"))
    ap.add_argument("--names", type=Path, default=DEFAULT_NAMES_PATH,
                    help="キュレーション済みワードリスト（ADR-0011）。既定: tools/generate/names.json")
    ap.add_argument("--model", default="black-forest-labs/FLUX.1-schnell")
    ap.add_argument("--steps", type=int, default=4)         # schnell は 4 ステップ
    ap.add_argument("--guidance", type=float, default=0.0)  # schnell は guidance 無効（0）
    ap.add_argument("--size", type=int, default=1024)
    # FLUX.1 は約12B params（bf16で~24GB）。大容量GPU（VRAM 62GB 等）なら全載せが速いので既定はオフロード無効。
    # VRAM が ~24GB 以下で OOM する環境のみ --offload を付けて CPU オフロード＋VAE分割に切り替える。
    ap.add_argument("--offload", action=argparse.BooleanOptionalAction, default=False,
                    help="CPU オフロードでVRAMを節約（小容量GPU向け）。既定OFF＝GPUに全載せ（大容量GPUで高速）。")
    ap.add_argument("--rarities", type=str, default=None,
                    help="テスト用: レア度を明示してクォータ配分を上書き。"
                         "単一値 '5'=全て★5、'1,2,3,4,5'=各画像に個別指定（件数=count）。")
    # FLUX は alpha を直接出せないため、白背景で生成 → rembg で切り抜いて透過 RGBA を出力（既定ON）。
    ap.add_argument("--matte", action=argparse.BooleanOptionalAction, default=True,
                    help="生成直後に白背景を透過化して RGBA PNG で出力（既定ON）。--no-matte で白背景のまま。")
    ap.add_argument("--matte-cpu", action="store_true",
                    help="透過化(rembg)を GPU があっても CPU で実行する")
    args = ap.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    specs = build_specs(args.count, args.names)
    if args.rarities:
        vals = [int(x) for x in args.rarities.split(",")]
        quota = vals * args.count if len(vals) == 1 else vals
        if len(quota) != args.count:
            raise ValueError(f"--rarities の件数({len(quota)})が count({args.count})と不一致")
        if any(r < 1 or r > 5 for r in quota):
            raise ValueError(f"--rarities は 1〜5 の整数のみ: {quota}")
    else:
        quota = allocate_rarities(args.count)  # レア度昇順。idx 順に消費する。
    # python -O でも消えないよう assert ではなく明示チェック。
    if not (len(specs) == len(quota) == args.count):
        raise ValueError(
            f"内部整合エラー: specs={len(specs)} quota={len(quota)} count={args.count}"
        )

    # 遅延 import（語彙検証だけしたいときに torch ロードを避ける）。
    import torch
    from diffusers import FluxPipeline

    # 透過化セッション（白背景 → 切り抜き）。FLUX は alpha 非対応なので生成直後に rembg で抜く。
    matte_session = None
    if args.matte:
        from matting import make_session
        matte_session, matte_providers = make_session(force_cpu=args.matte_cpu)
        print(f"matte providers: {matte_providers}"
              f"（{'GPU' if 'CUDAExecutionProvider' in matte_providers else 'CPU'}）")

    pipe = FluxPipeline.from_pretrained(args.model, torch_dtype=torch.bfloat16)
    if args.offload:
        # 小容量GPU向け: モデルを CPU に置き、必要なコンポーネントだけ都度 GPU へ移す（OOM 回避・低速）。
        # .to("cuda") はオフロードと競合するため呼ばない。
        pipe.enable_model_cpu_offload()
        # VAE のデコードを分割・タイル化してピークVRAMをさらに削減。
        pipe.vae.enable_slicing()
        pipe.vae.enable_tiling()
    else:
        # 大容量GPU（VRAM 62GB 等）: モデル一式を GPU 常駐させて最速で回す（VAE分割/タイルは使わない）。
        pipe = pipe.to("cuda")

    # 注: FLUX.1 [schnell] は guidance 無効・negative_prompt 非対応。レア度演出は
    #     ポジティブプロンプト（RARITY_EFFECT）で表現する。
    manifest = []
    for i, (spec, rarity) in enumerate(zip(specs, quota), start=1):
        prompt = build_prompt(spec["subject"], rarity)
        seed = SEED_BASE + i
        image = pipe(
            prompt=prompt,
            num_inference_steps=args.steps,
            guidance_scale=args.guidance,
            width=args.size, height=args.size,
            generator=torch.Generator("cuda").manual_seed(seed),
        ).images[0]

        image_id = str(uuid.uuid4())
        if matte_session is not None:
            from matting import cutout
            image = cutout(image.convert("RGBA"), matte_session)  # 白背景を抜いて透過 RGBA に
        image.save(args.out / f"{image_id}.png")  # RGBA（透過）or RGB（--no-matte）の PNG 中間
        manifest.append({
            "image_id": image_id,
            "idx": i,
            "r2_key": f"img/{image_id}.webp",
            "format": "webp",
            "name": spec["name"],          # 日本語表示名（ADR-0010）
            "width": 768, "height": 768,   # postprocess 後の最終サイズ
            "bytes": 0,                     # postprocess が WebP サイズで埋める
            "rarity": rarity,
            # --- 再現性メタ（ADR-0003 決定5）。gen-import-sql.mjs は使わないが残す ---
            "seed": seed,
            "model": args.model,
            "prompt": prompt,
        })
        if i % 50 == 0:
            print(f"{i}/{args.count}")

    args.manifest.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"done: {len(manifest)} images -> {args.out}, manifest -> {args.manifest}")


if __name__ == "__main__":
    main()
