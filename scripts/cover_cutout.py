"""On-device foreground extraction. The optional runtime is shared by local cover projects."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
from urllib.request import urlopen

from cover_paths import data_directory

CACHE = data_directory() / "cutout"
MODEL = CACHE / "u2netp.onnx"
MODEL_URL = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx"
MODEL_SHA = "309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8"
VENV = CACHE / ("runtime-" + sys.implementation.cache_tag)
PYTHON = VENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
READY = VENV / ".ready"
BUSY = threading.Lock()


def interpreter():
    if all(importlib.util.find_spec(name) for name in ("PIL", "onnxruntime", "numpy")):
        return sys.executable
    if READY.is_file() and PYTHON.is_file():
        return str(PYTHON)


def setup():
    from cover_review import review_lock
    from cover_project import write_atomic
    CACHE.mkdir(parents=True, exist_ok=True)
    with review_lock(CACHE, ".setup.lock"):
        if not MODEL.is_file() or hashlib.sha256(MODEL.read_bytes()).hexdigest() != MODEL_SHA:
            with urlopen(MODEL_URL, timeout=60) as stream:
                data = stream.read(5_000_000)
            if hashlib.sha256(data).hexdigest() != MODEL_SHA:
                raise ValueError("抠图模型下载不完整，请重试。")
            write_atomic(MODEL, data)
        if not interpreter():
            import venv
            venv.EnvBuilder(with_pip=True).create(VENV)
            subprocess.run([str(PYTHON), "-m", "pip", "install", "--only-binary=:all:",
                            "--disable-pip-version-check", "onnxruntime", "Pillow", "numpy"],
                           check=True, timeout=300)
            subprocess.run([str(PYTHON), "-c", "import PIL, numpy, onnxruntime"], check=True)
            READY.touch()


def extract(source):
    import numpy as np
    import onnxruntime as ort
    from PIL import Image, ImageChops
    if hashlib.sha256(MODEL.read_bytes()).hexdigest() != MODEL_SHA:
        raise ValueError("本机模型文件不完整，请重新安装抠图组件。")
    options = ort.SessionOptions()
    options.intra_op_num_threads = min(os.cpu_count() or 1, 4)
    session = ort.InferenceSession(str(MODEL), options, providers=["CPUExecutionProvider"])
    with Image.open(source) as opened:
        portrait = opened.convert("RGBA")
    # Transparent pixels can carry arbitrary RGB values. Composite before inference.
    small = portrait.resize((320, 320), Image.Resampling.LANCZOS)
    matte = Image.new("RGB", small.size, (240, 240, 240))
    matte.paste(small, mask=small.getchannel("A"))
    rgb = np.asarray(matte, dtype=np.float32)
    rgb /= max(1.0, float(rgb.max()))
    rgb -= np.array([0.485, 0.456, 0.406], dtype=np.float32)
    rgb /= np.array([0.229, 0.224, 0.225], dtype=np.float32)
    tensor = np.ascontiguousarray(rgb.transpose(2, 0, 1)[None, ...])
    mask = session.run([session.get_outputs()[0].name], {session.get_inputs()[0].name: tensor})[0][0, 0]
    bottom, top = float(mask.min()), float(mask.max())
    if top - bottom < 0.05:
        raise ValueError("没有识别出清晰的人物轮廓，可以保留原图。")
    mask = (mask - bottom) / (top - bottom)
    if np.mean(mask > 0.5) < 0.005 or np.mean(mask < 0.5) < 0.005:
        raise ValueError("没有分出清晰的人物和背景，可以保留原图。")
    alpha = Image.fromarray((mask * 255).round().astype("uint8")).resize(portrait.size, Image.Resampling.LANCZOS)
    alpha = ImageChops.darker(portrait.getchannel("A"), alpha)
    if not alpha.getbbox():
        raise ValueError("未找到可保留的人物，可以保留原图。")
    portrait.putalpha(alpha)
    portrait.save(sys.stdout.buffer, format="PNG")


def preview(project, payload):
    from cover_project import IMAGE, image_asset, layers_for_format
    file = payload.get("file")
    layers = layers_for_format(json.loads((project / "cover.json").read_bytes()), payload.get("format", "portrait"))
    if not isinstance(file, str) or not IMAGE.fullmatch(file) or not any(
        l["kind"] == "character" and l["id"] == payload.get("layer") and l.get("src") == file for l in layers
    ):
        raise ValueError("人物图层已更换，请重新打开抠图预览。")
    python = interpreter()
    if not python or not MODEL.is_file():
        return {"setupRequired": True}
    if not BUSY.acquire(blocking=False):
        raise ValueError("正在处理另一张人物图，请稍后重试。")
    try:
        process = subprocess.run([python, str(Path(__file__).resolve()), "extract", str(project / "assets" / file)],
                                 capture_output=True, timeout=120, env={**os.environ, "PYTHONIOENCODING":"utf-8"})
        if process.returncode:
            message = process.stderr.decode("utf-8", errors="replace").strip()
            raise ValueError(message if process.returncode == 2 else "本机抠图失败，可以保留原图或重新尝试。")
        return image_asset(project, process.stdout)
    finally:
        BUSY.release()


if __name__ == "__main__":
    if sys.argv[1:] == ["setup"]:
        setup()
    elif len(sys.argv) == 3 and sys.argv[1] == "extract":
        try:
            extract(Path(sys.argv[2]))
        except ValueError as err:
            print(err, file=sys.stderr)
            sys.exit(2)
    else:
        raise SystemExit("Use setup, or extract <image>")
