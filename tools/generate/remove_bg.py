#!/usr/bin/env python3
"""webp/ の画像の白背景を透過にする（rembg / U2-Net系）。【単体・高速版／このファイルだけで完結】

通常は generate.py が生成時に透過化するため不要。**既に白背景で生成済みの画像**を後から透過化したいときに使う。
高速化の要点:
- GPU(CUDA) を優先し、実際に有効な provider を表示。CPU に静かに落ちている場合は大きく警告（＝遅さの主因）。
  RTX PRO 6000(Blackwell/sm_120) は CUDA 12.8・cuDNN9 対応の onnxruntime-gpu(>=1.21) が必要。
- WebP は method=4（ロスレスのまま・エンコードが速い）。
- CPU 実行時は 16 コア等で**マルチプロセス並列**（既定 auto）。GPU 実行時は単発が最速（GPUは逐次）。
- モデルは速度優先なら u2net/u2netp（既定 isnet-general-use=高品質・やや重い）。白背景の化石は u2net で十分。
- 透過が強すぎて被写体が黒抜けする時は **--fill-holes（既定ON）が内部の穴を埋め直す**。さらに痩せる場合は
  `--dilate 1〜3` で縁を復元、`--alpha-threshold` を下げると全体的に多く残す（透過を弱める）。
- 重要: rembg は背景画素の RGB を黒に潰すため、本スクリプトは **マスク（アルファ）だけ rembg から採用し、
  RGB は元イラストから合成**する。これにより穴埋め部分が黒くならず元の色（石板など）で復活する。

依存:
    pip install -U -r requirements.txt        # rembg / onnxruntime-gpu / pillow
使い方:
    python remove_bg.py --in webp --out webp_transparent --manifest manifest.json
    python remove_bg.py --in webp --out webp_transparent --model u2net --workers 16
"""
import argparse
import json
import os
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import onnxruntime as ort
from PIL import Image
from rembg import remove, new_session

try:
    import numpy as np
    from scipy import ndimage
    _HAVE_SCIPY = True
except Exception:                                          # numpy/scipy 無し（imagehash 依存で通常は有る）
    _HAVE_SCIPY = False

# 各ワーカー（プロセス）が自分の rembg セッションを1つ持つ（セッションは pickle 不可のため）。
_SESSION = None
_ALPHA = False
_QUALITY = 100
_METHOD = 4
_FILL_HOLES = True       # 被写体内部にできた透過の穴を埋める（黒抜け対策）
_DILATE = 0              # マスクを N px 膨張させて削れたエッジを復元
_ALPHA_THR = 128         # 前景とみなす alpha しきい値（穴埋め・膨張の判定用）


def pick_providers(force_cpu: bool) -> list[str]:
    avail = ort.get_available_providers()
    if not force_cpu and "CUDAExecutionProvider" in avail:
        return ["CUDAExecutionProvider", "CPUExecutionProvider"]
    return ["CPUExecutionProvider"]


def _make_session(model: str, force_cpu: bool):
    sess = new_session(model, providers=pick_providers(force_cpu))
    inner = getattr(sess, "inner_session", None)
    active = inner.get_providers() if inner is not None else pick_providers(force_cpu)
    return sess, active


def _init_worker(model: str, force_cpu: bool, alpha: bool, quality: int, method: int,
                 fill_holes: bool, dilate: int, alpha_thr: int) -> None:
    global _SESSION, _ALPHA, _QUALITY, _METHOD, _FILL_HOLES, _DILATE, _ALPHA_THR
    _SESSION, _ = _make_session(model, force_cpu)
    _ALPHA, _QUALITY, _METHOD = alpha, quality, method
    _FILL_HOLES, _DILATE, _ALPHA_THR = fill_holes, dilate, alpha_thr


def _refine_mask(mask):
    """rembg のマスク（アルファ）を弱める。被写体内部の穴を埋め、必要なら縁を膨張で復元する。

    - 穴埋め: 前景に囲まれた領域（＝石板の中など内部）を不透明に戻す。外周の白背景は背景のまま。
    - 膨張: マスクを N px 太らせ、削れた被写体の縁を取り戻す（ソフトな縁は残す）。
    戻り値は uint8 のアルファ配列。
    """
    if not _HAVE_SCIPY or (not _FILL_HOLES and _DILATE <= 0):
        return mask
    mask = mask.copy()
    fg = mask >= _ALPHA_THR                               # 前景マスク（2値）
    if _FILL_HOLES:
        filled = ndimage.binary_fill_holes(fg)
        mask[filled & ~fg] = 255                          # 内部の穴だけ不透明に（縁のソフトさは保持）
        fg = filled
    if _DILATE > 0:
        grown = ndimage.binary_dilation(fg, iterations=_DILATE)
        mask[grown & ~fg] = 255                           # 削れた縁を復元
    return mask


def _process_one(paths: tuple[str, str]) -> tuple[str, int]:
    src, dst = Path(paths[0]), Path(paths[1])
    orig = Image.open(src).convert("RGB")                 # 元イラストの RGB（色はここから取る）
    base = orig.convert("RGBA")
    if _ALPHA:
        cut = remove(base, session=_SESSION, alpha_matting=True,
                     alpha_matting_foreground_threshold=240,
                     alpha_matting_background_threshold=10,
                     alpha_matting_erode_size=3)
    else:
        cut = remove(base, session=_SESSION)             # 既定: マスクのみ（高速・警告なし）
    if _HAVE_SCIPY:
        # rembg は背景画素の RGB を黒に潰すため、**マスク（アルファ）だけ採用し RGB は元画像から合成**する。
        # これで穴埋めした領域も黒ではなく元の色（石板など）で復活する。
        mask = _refine_mask(np.asarray(cut)[:, :, 3])
        out = np.dstack([np.asarray(orig), mask]).astype(np.uint8)
        result = Image.fromarray(out, "RGBA")
    else:
        result = cut                                     # numpy/scipy 無し: rembg 出力をそのまま
    if _QUALITY >= 100:
        result.save(dst, "WEBP", lossless=True, quality=100, method=_METHOD)
    else:
        result.save(dst, "WEBP", quality=_QUALITY, method=_METHOD)
    return src.stem, dst.stat().st_size                  # stem = image_id


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", type=Path, default=Path("webp"))
    ap.add_argument("--out", type=Path, default=Path("webp_transparent"))
    ap.add_argument("--manifest", type=Path, default=None,
                    help="渡すと透過後の bytes でマニフェストを更新（image_id 照合）")
    ap.add_argument("--model", default="isnet-general-use",
                    help="rembg モデル。既定 isnet-general-use（1024・高品質）。速度優先は u2net（320・高速）/ u2netp（最速）。")
    ap.add_argument("--cpu", action="store_true", help="GPU があっても CPU で実行する")
    ap.add_argument("--workers", type=int, default=0,
                    help="並列プロセス数。0=auto（GPUなら1／CPUなら最大16コア）。GPUは逐次なので並列しても速くならない。")
    ap.add_argument("--quality", type=int, default=100, help="WebP 品質。100=ロスレス（既定）。100未満でロスシー。")
    ap.add_argument("--method", type=int, default=4, help="WebP エンコード手法 0-6。小さいほど速い（既定4）。6は最小サイズだが遅い。")
    ap.add_argument("--alpha-matting", action="store_true",
                    help="輪郭を alpha matting で精緻化（既定OFF・遅い・性能警告あり）。曖昧な縁の時だけ。")
    # --- 透過を弱める（黒抜け対策） ---
    ap.add_argument("--fill-holes", action=argparse.BooleanOptionalAction, default=True,
                    help="被写体内部にできた透過の穴を埋める（既定ON）。元イラストが黒く抜ける時の主対策。--no-fill-holes で無効。")
    ap.add_argument("--dilate", type=int, default=0,
                    help="マスクを N px 膨張させて削れた縁を復元（既定0）。被写体が痩せる時に 1〜3 を試す。")
    ap.add_argument("--alpha-threshold", type=int, default=128,
                    help="前景とみなす alpha しきい値 0-255（既定128）。下げるほど多く残す（透過を弱める）。")
    args = ap.parse_args()
    if (args.fill_holes or args.dilate > 0) and not _HAVE_SCIPY:
        print("[WARN] numpy/scipy が無いため穴埋め・膨張をスキップします（pip install scipy numpy）。")

    args.out.mkdir(parents=True, exist_ok=True)

    # provider を確認し、CUDA 要求なのに CPU に落ちていれば大きく警告（遅さの主因）。
    requested = pick_providers(args.cpu)
    _, active = _make_session(args.model, args.cpu)
    using_gpu = "CUDAExecutionProvider" in active
    print(f"rembg providers: {active}（{'GPU' if using_gpu else 'CPU'}）model={args.model}")
    if not args.cpu and "CUDAExecutionProvider" in requested and not using_gpu:
        print("[WARN] CUDA を要求しましたが CPU にフォールバックしています（＝遅い）。\n"
              "       Blackwell(RTX PRO 6000) は CUDA 12.8・cuDNN9 対応が必要:\n"
              "         pip uninstall -y onnxruntime onnxruntime-gpu && pip install -U \"onnxruntime-gpu>=1.21\"")

    files = sorted(args.src.glob("*.webp"))
    if not files:
        print(f"[WARN] {args.src} に .webp が見つかりません")
        return

    # workers 決定: GPU は逐次なので 1、CPU は最大 16 コアまで並列。
    if args.workers > 0:
        workers = args.workers
    else:
        workers = 1 if using_gpu else min(16, os.cpu_count() or 1)
    if using_gpu and workers > 1:
        print(f"[INFO] GPU 実行中は workers=1 が最速（GPUは逐次）。指定 {workers} は無視して 1 にします。")
        workers = 1

    jobs = [(str(f), str(args.out / f.name)) for f in files]
    print(f"start: {len(jobs)} 枚 / workers={workers} / method={args.method}")
    t0 = time.time()
    sizes: dict[str, int] = {}
    init_args = (args.model, args.cpu, args.alpha_matting, args.quality, args.method,
                 args.fill_holes, args.dilate, args.alpha_threshold)
    if workers == 1:
        _init_worker(*init_args)
        for i, job in enumerate(jobs, start=1):
            stem, sz = _process_one(job)
            sizes[stem] = sz
            if i % 25 == 0:
                print(f"{i}/{len(jobs)}  {i/(time.time()-t0):.1f} 枚/秒")
    else:
        with ProcessPoolExecutor(max_workers=workers,
                                 initializer=_init_worker, initargs=init_args) as ex:
            for i, (stem, sz) in enumerate(ex.map(_process_one, jobs), start=1):
                sizes[stem] = sz
                if i % 25 == 0:
                    print(f"{i}/{len(jobs)}  {i/(time.time()-t0):.1f} 枚/秒")

    elapsed = time.time() - t0
    if args.manifest:
        manifest = json.loads(args.manifest.read_text())
        for row in manifest:
            if row["image_id"] in sizes:
                row["bytes"] = sizes[row["image_id"]]
        args.manifest.write_text(json.dumps(manifest, indent=2) + "\n")
        print(f"manifest updated: {args.manifest}（透過後 bytes）")
    print(f"done: {len(jobs)} 枚 -> {args.out}  {elapsed:.1f}s  平均 {len(jobs)/max(elapsed,1e-9):.1f} 枚/秒")


if __name__ == "__main__":
    main()
