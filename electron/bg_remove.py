# OPNduck — local-first media processing suite.
# Copyright (C) 2026 Aaron Jonsson. GPL-3.0-or-later (see LICENSE).
#
# Cuts the person or object out of a picture or video, with no green screen.
#   python bg_remove.py image <in> <out.png> [model]
#   python bg_remove.py video <in.json>      (a job: input, output, ffmpeg, mode, color, bgImage, quality, width, height, fps, codec)
# Pictures use rembg; video uses RobustVideoMatting (it keeps state between frames, so nothing flickers). Frames stream
# through FFmpeg pipes, so no temporary images are written. Prints "@@STAGE <text>", "@@PROGRESS <0..1>", then "@@DONE"
# or "@@FAIL <why>".
import json
import subprocess
import sys

import numpy as np


def say(kind, value=""):
    print(f"@@{kind} {value}".rstrip(), flush=True)


def image(src, dest, model="u2net"):
    from PIL import Image
    from rembg import new_session, remove

    say("STAGE", "Loading the model (it downloads once)")
    session = new_session(model)
    say("STAGE", "Cutting out")
    with Image.open(src) as im:
        out = remove(im.convert("RGB"), session=session)
    out.save(dest)
    say("DONE")


def background(mode, w, h, color, bg_image, frames_rgb):
    """The picture that goes behind the person: a flat colour, a blurred copy, or a picture; None for transparent."""
    if mode == "color":
        c = tuple(int(color.lstrip("#")[i : i + 2], 16) for i in (0, 2, 4))
        return np.full((h, w, 3), c, dtype=np.uint8)
    if mode == "image":
        from PIL import Image

        return np.asarray(Image.open(bg_image).convert("RGB").resize((w, h)))
    return None


# The official RobustVideoMatting weights as ONNX files (data for onnxruntime to run: no code is downloaded or executed),
# pinned by checksum so a changed or damaged file is refused.
RVM = {
    "fast": ("rvm_mobilenetv3_fp32.onnx", "88d4531297118f595bf2fd60f6f566aec2e559393802d1f436c380f0cbbd2828"),
    "best": ("rvm_resnet50_fp32.onnx", "25db300fcb6ee27f941a1b52c97856e8d1f13c7f35817f81a612f89af0e8a85c"),
}
RVM_URL = "https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/"


def weights(quality, folder):
    """The model file, downloaded once into `folder` and checked against its pinned SHA-256."""
    import hashlib
    import os
    import urllib.request

    name, want = RVM["best" if quality == "best" else "fast"]
    path = os.path.join(folder, name)

    def ok(p):
        h = hashlib.sha256()
        with open(p, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        return h.hexdigest() == want

    if os.path.exists(path) and ok(path):
        return path
    os.makedirs(folder, exist_ok=True)
    part = path + ".part"
    urllib.request.urlretrieve(RVM_URL + name, part)
    if not ok(part):
        os.remove(part)
        raise RuntimeError("The downloaded model does not match its published checksum")
    os.replace(part, path)
    return path


def video(job):
    import onnxruntime as ort

    say("STAGE", "Loading the model (it downloads once)")
    session = ort.InferenceSession(weights(job.get("quality"), job["modelDir"]), providers=[p for p in ("CUDAExecutionProvider", "CPUExecutionProvider") if p in ort.get_available_providers()])
    w, h, fps = job["width"], job["height"], job["fps"]
    mode = job["mode"]
    ffmpeg = job.get("ffmpeg", "ffmpeg")
    dec = subprocess.Popen([ffmpeg, "-v", "error", "-i", job["input"], "-vf", f"scale={w}:{h}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
    transparent = mode == "transparent"
    pix = "rgba" if transparent else "rgb24"
    codec = job["codec"] if transparent else None
    enc_args = (["-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "28", "-auto-alt-ref", "0"] if codec == "webm" else ["-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le"]) if transparent else ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18"]
    enc = subprocess.Popen([ffmpeg, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", pix, "-s", f"{w}x{h}", "-r", str(fps), "-i", "-", "-i", job["input"], "-map", "0:v", "-map", "1:a?", *enc_args, "-c:a", "copy" if not transparent or codec != "webm" else "libopus", "-shortest", job["output"]], stdin=subprocess.PIPE)
    plain = background(mode, w, h, job.get("color", "#00ff00"), job.get("bgImage"), None)
    n = 0
    total = max(1, int(job.get("frames", 1)))
    size = w * h * 3
    ratio = np.array([min(1.0, 512 / max(w, h))], dtype=np.float32)
    rec = [np.zeros((1, 1, 1, 1), dtype=np.float32) for _ in range(4)]  # the model's memory of the frames before
    say("STAGE", "Cutting out the video")
    while True:
        buf = dec.stdout.read(size)
        if len(buf) < size:
            break
        frame = np.frombuffer(buf, dtype=np.uint8).reshape(h, w, 3)
        src = np.ascontiguousarray(frame.transpose(2, 0, 1)[None].astype(np.float32) / 255.0)
        _fgr, pha, *rec = session.run(None, {"src": src, "r1i": rec[0], "r2i": rec[1], "r3i": rec[2], "r4i": rec[3], "downsample_ratio": ratio})
        alpha = np.clip(pha[0, 0], 0, 1)
        if transparent:
            out = np.dstack([frame, (alpha * 255).astype(np.uint8)])
        else:
            if mode == "blur":
                from PIL import Image, ImageFilter

                base = np.asarray(Image.fromarray(frame).filter(ImageFilter.GaussianBlur(max(6, w // 80))))
            else:
                base = plain
            out = (frame * alpha[..., None] + base * (1 - alpha[..., None])).astype(np.uint8)
        enc.stdin.write(out.tobytes())
        n += 1
        if n % 5 == 0:
            say("PROGRESS", f"{min(0.99, n / total):.4f}")
    enc.stdin.close()
    if enc.wait() != 0:
        raise RuntimeError("FFmpeg could not write the result")
    dec.wait()
    say("DONE")


if __name__ == "__main__":
    try:
        if sys.argv[1] == "image":
            image(sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else "u2net")
        else:
            video(json.load(open(sys.argv[2])))
    except Exception as err:  # the caller shows this text
        say("FAIL", err)
        sys.exit(1)
