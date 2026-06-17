#!/usr/bin/env python3
"""生成画像の後処理（ADR-0003 決定4・Open「近似重複排除」）。

- 1024px 透過PNG（中間・RGBA） → 768px 透過WebP ロスレス（出力は WebP / 2026-06-16 ユーザー方針・端末容量配慮）。
  ※ generate.py が白背景を切り抜いて透過出力するため、ここでも **alpha（透過）を保持**してリサイズ・保存する。
- pHash で近似重複を除去（透過部は白に合成して計算・しきい値はハミング距離）。
- 残った画像で idx を 1..N に振り直し、bytes を WebP サイズで埋めてマニフェストを更新。

※ レア度エフェクトは **generate.py のプロンプト側**で付与する（ADR-0009 / Lv1〜5）。後処理では合成しない。
※ WebP はロスレス（劣化なし）。PNG より小さく、iPhone/Flutter で表示可。さらに容量を詰めたい場合は
  `--quality` を 100 未満にしてロスシー WebP に切り替える（既定はロスレス）。

使い方:
    python postprocess.py --in out --webp webp --manifest manifest.json --threshold 5
"""
import argparse
import json
from pathlib import Path

import imagehash
from PIL import Image


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", type=Path, default=Path("out"))
    ap.add_argument("--webp", type=Path, default=Path("webp"))
    ap.add_argument("--manifest", type=Path, default=Path("manifest.json"))
    ap.add_argument("--size", type=int, default=768)
    ap.add_argument("--threshold", type=int, default=5, help="pHash ハミング距離の重複しきい値")
    ap.add_argument("--quality", type=int, default=100,
                    help="WebP 品質。100=ロスレス（既定）。100未満でロスシー（より小さい）")
    args = ap.parse_args()

    args.webp.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(args.manifest.read_text())

    kept_hashes: list[imagehash.ImageHash] = []
    kept = []
    dropped = 0
    for row in manifest:
        src = args.src / f"{row['image_id']}.png"
        if not src.exists():
            print(f"[WARN] 元PNGなし: {src}")
            continue
        # 透過(RGBA)を保持してリサイズ。generate.py が透過出力するため alpha を残す。
        im = Image.open(src).convert("RGBA").resize((args.size, args.size), Image.LANCZOS)
        # pHash は透過部を白に合成した RGB で計算（背景が透明でもハッシュを安定化）。
        flat = Image.alpha_composite(Image.new("RGBA", im.size, (255, 255, 255, 255)), im).convert("RGB")
        h = imagehash.phash(flat)
        if any((h - prev) <= args.threshold for prev in kept_hashes):
            dropped += 1
            continue  # 近似重複 → スキップ
        kept_hashes.append(h)
        dst = args.webp / f"{row['image_id']}.webp"
        if args.quality >= 100:
            im.save(dst, "WEBP", lossless=True, quality=100, method=6)  # 劣化なし・alpha 保持
        else:
            im.save(dst, "WEBP", quality=args.quality, method=6)        # ロスシー（より小さい）・alpha 保持
        row["width"] = args.size
        row["height"] = args.size
        row["bytes"] = dst.stat().st_size
        kept.append(row)

    # idx を 1..N に振り直す（重複除去で穴が空くため / images.idx は 1..N UNIQUE）。
    for i, row in enumerate(kept, start=1):
        row["idx"] = i

    args.manifest.write_text(json.dumps(kept, indent=2) + "\n")
    total_bytes = sum(r["bytes"] for r in kept)
    print(f"kept {len(kept)} / {len(manifest)} (dropped {dropped} near-dupes)")
    print(f"webp -> {args.webp}, total {total_bytes/1024/1024:.1f} MB, "
          f"avg {total_bytes/max(len(kept),1)/1024:.0f} KB/img")


if __name__ == "__main__":
    main()
