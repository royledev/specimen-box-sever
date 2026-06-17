#!/usr/bin/env python3
"""背景透過（rembg / U2-Net系）の共有ヘルパー。generate.py（生成時に統合）と remove_bg.py（後段の単体実行）が使う。

FLUX.1 [schnell] は alpha を直接出力できないため、白背景で生成 → 本ヘルパーでマスク切り抜き → 透過 RGBA にする。
推論は GPU(CUDA) 優先・無ければ CPU 自動フォールバック。依存は requirements.txt（rembg / onnxruntime-gpu / pillow）。
"""
import onnxruntime as ort
from rembg import remove, new_session


def pick_providers(force_cpu: bool = False) -> list[str]:
    """利用可能なら CUDA(GPU) を優先。無ければ CPU にフォールバック。"""
    avail = ort.get_available_providers()
    if not force_cpu and "CUDAExecutionProvider" in avail:
        return ["CUDAExecutionProvider", "CPUExecutionProvider"]
    return ["CPUExecutionProvider"]


def make_session(model: str = "isnet-general-use", force_cpu: bool = False):
    """rembg セッションを作る。戻り値: (session, active_providers)。

    CUDA を要求したのに実際には CPU にフォールバックしている（＝静かに遅くなる）ケースを検出して
    大きく警告する。Blackwell(RTX PRO 6000=sm_120) は CUDA 12.8/cuDNN9 対応の onnxruntime-gpu が必要。
    """
    requested = pick_providers(force_cpu)
    sess = new_session(model, providers=requested)
    # rembg は内部に onnxruntime.InferenceSession を持つ。実際に有効な provider を確認する。
    inner = getattr(sess, "inner_session", None)
    active = inner.get_providers() if inner is not None else requested
    if (not force_cpu
            and "CUDAExecutionProvider" in requested
            and "CUDAExecutionProvider" not in active):
        print("[WARN] CUDA を要求しましたが onnxruntime が CPU にフォールバックしています（＝遅い）。\n"
              "       onnxruntime-gpu と CUDA/cuDNN の対応を確認してください。\n"
              "       RTX PRO 6000(Blackwell/sm_120) は CUDA 12.8・cuDNN9 対応ビルドが必要:\n"
              "         pip install -U \"onnxruntime-gpu>=1.21\"")
    return sess, active, providers


def cutout(img, session, alpha_matting: bool = False):
    """白背景を抜いて RGBA を返す。

    alpha_matting=True は縁を精緻化するが pymatting 由来の性能警告と低速化に注意
    （`PERFORMANCE WARNING: ... incomplete Cholesky ...`＝遅いソルバへのフォールバック・出力は正常）。
    輪郭が明瞭な化石は既定（マスクのみ）で十分。
    """
    if alpha_matting:
        return remove(
            img,
            session=session,
            alpha_matting=True,
            alpha_matting_foreground_threshold=240,
            alpha_matting_background_threshold=10,
            alpha_matting_erode_size=3,
        )
    return remove(img, session=session)
