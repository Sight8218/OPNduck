# OPNduck — local-first media processing suite.
# Copyright (C) 2026 Aaron Jonsson. GPL-3.0-or-later (see LICENSE).
#
# Splits a stereo 44.1 kHz WAV into "vocals" and "no_vocals" with Demucs (htdemucs), using
# soundfile for audio I/O instead of torchaudio's loaders (those need extra backends on recent
# torch). Run by electron/main.cjs as:  python -c <this script> <in.wav> <out dir>
#
# Writes <out dir>/vocals.wav and <out dir>/no_vocals.wav. Progress is the tqdm percentage Demucs
# prints on stderr; the model (~80 MB) downloads once into the user's torch cache.
import json
import sys

import numpy as np
import soundfile as sf
# Video upscaling with Real-ESRGAN in PyTorch, streaming frames through pipes (no PNG files):
#   ffmpeg (decode, raw RGB) -> GPU model in half precision -> ffmpeg (encode + the original audio)
# Run as `python -c <this file> --job <json>`. stdout: "STAGE <name>" and "PROGRESS <0-1>" lines (parsed by
# main.cjs); the two ffmpegs' diagnostics go to stderr so they show up in the live log.
# Architectures are the ones from the Real-ESRGAN project (BSD-3-Clause), written out here so no extra
# packages (basicsr) are needed. Weights load with strict=True: a mismatch fails instead of upscaling garbage.
import json
import os
import signal
import subprocess
import sys
import threading
import queue
import time

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F


class SRVGGNetCompact(nn.Module):  # realesr-animevideov3
    def __init__(self, num_in_ch=3, num_out_ch=3, num_feat=64, num_conv=16, upscale=4):
        super().__init__()
        self.upscale = upscale
        self.body = nn.ModuleList([nn.Conv2d(num_in_ch, num_feat, 3, 1, 1), nn.PReLU(num_parameters=num_feat)])
        for _ in range(num_conv):
            self.body.append(nn.Conv2d(num_feat, num_feat, 3, 1, 1))
            self.body.append(nn.PReLU(num_parameters=num_feat))
        self.body.append(nn.Conv2d(num_feat, num_out_ch * upscale * upscale, 3, 1, 1))
        self.upsampler = nn.PixelShuffle(upscale)

    def forward(self, x):
        out = x
        for layer in self.body:
            out = layer(out)
        return self.upsampler(out) + F.interpolate(x, scale_factor=self.upscale, mode="nearest")


class ResidualDenseBlock(nn.Module):
    def __init__(self, num_feat=64, num_grow_ch=32):
        super().__init__()
        self.conv1 = nn.Conv2d(num_feat, num_grow_ch, 3, 1, 1)
        self.conv2 = nn.Conv2d(num_feat + num_grow_ch, num_grow_ch, 3, 1, 1)
        self.conv3 = nn.Conv2d(num_feat + 2 * num_grow_ch, num_grow_ch, 3, 1, 1)
        self.conv4 = nn.Conv2d(num_feat + 3 * num_grow_ch, num_grow_ch, 3, 1, 1)
        self.conv5 = nn.Conv2d(num_feat + 4 * num_grow_ch, num_feat, 3, 1, 1)
        self.lrelu = nn.LeakyReLU(negative_slope=0.2, inplace=True)

    def forward(self, x):
        x1 = self.lrelu(self.conv1(x))
        x2 = self.lrelu(self.conv2(torch.cat((x, x1), 1)))
        x3 = self.lrelu(self.conv3(torch.cat((x, x1, x2), 1)))
        x4 = self.lrelu(self.conv4(torch.cat((x, x1, x2, x3), 1)))
        x5 = self.conv5(torch.cat((x, x1, x2, x3, x4), 1))
        return x5 * 0.2 + x


class RRDB(nn.Module):
    def __init__(self, num_feat, num_grow_ch=32):
        super().__init__()
        self.rdb1 = ResidualDenseBlock(num_feat, num_grow_ch)
        self.rdb2 = ResidualDenseBlock(num_feat, num_grow_ch)
        self.rdb3 = ResidualDenseBlock(num_feat, num_grow_ch)

    def forward(self, x):
        return self.rdb3(self.rdb2(self.rdb1(x))) * 0.2 + x


class RRDBNet(nn.Module):  # RealESRGAN_x4plus (23 blocks) and RealESRGAN_x4plus_anime_6B (6 blocks); native x4
    def __init__(self, num_in_ch=3, num_out_ch=3, num_feat=64, num_block=23, num_grow_ch=32):
        super().__init__()
        self.conv_first = nn.Conv2d(num_in_ch, num_feat, 3, 1, 1)
        self.body = nn.Sequential(*[RRDB(num_feat, num_grow_ch) for _ in range(num_block)])
        self.conv_body = nn.Conv2d(num_feat, num_feat, 3, 1, 1)
        self.conv_up1 = nn.Conv2d(num_feat, num_feat, 3, 1, 1)
        self.conv_up2 = nn.Conv2d(num_feat, num_feat, 3, 1, 1)
        self.conv_hr = nn.Conv2d(num_feat, num_feat, 3, 1, 1)
        self.conv_last = nn.Conv2d(num_feat, num_out_ch, 3, 1, 1)
        self.lrelu = nn.LeakyReLU(negative_slope=0.2, inplace=True)

    def forward(self, x):
        feat = self.conv_first(x)
        feat = feat + self.conv_body(self.body(feat))
        feat = self.lrelu(self.conv_up1(F.interpolate(feat, scale_factor=2, mode="nearest")))
        feat = self.lrelu(self.conv_up2(F.interpolate(feat, scale_factor=2, mode="nearest")))
        return self.conv_last(self.lrelu(self.conv_hr(feat)))


MODELS = {
    "realesr-animevideov3": lambda: SRVGGNetCompact(),
    "realesrgan-x4plus": lambda: RRDBNet(num_block=23),
    "realesrgan-x4plus-anime": lambda: RRDBNet(num_block=6),
}


def load_model(name, weights_path, device):
    net = MODELS[name]()
    state = torch.load(weights_path, map_location="cpu", weights_only=True)
    state = state.get("params_ema", state.get("params", state))
    net.load_state_dict(state, strict=True)
    return net.eval().to(device).half().to(memory_format=torch.channels_last)


def emit(line):
    print(line, flush=True)


def pump_stderr(proc, tag):
    """Forward a child's diagnostics to our stderr (the live log) and keep its pipe drained."""
    def run():
        for raw in iter(proc.stderr.readline, b""):
            sys.stderr.write(f"[{tag}] {raw.decode(errors='replace').rstrip()}\n")
            sys.stderr.flush()
    t = threading.Thread(target=run, daemon=True)
    t.start()
    return t


def tiled(net, x, tile, pad=16):
    """Runs the net on overlapping tiles (for frames too big to fit in GPU memory at once)."""
    _, _, h, w = x.shape
    out = torch.empty((1, 3, h * 4, w * 4), dtype=x.dtype, device=x.device)
    for y0 in range(0, h, tile):
        for x0 in range(0, w, tile):
            y1, x1 = min(y0 + tile, h), min(x0 + tile, w)
            ya, xa, yb, xb = max(y0 - pad, 0), max(x0 - pad, 0), min(y1 + pad, h), min(x1 + pad, w)
            o = net(x[:, :, ya:yb, xa:xb])
            out[:, :, y0 * 4:y1 * 4, x0 * 4:x1 * 4] = o[:, :, (y0 - ya) * 4:(y0 - ya) * 4 + (y1 - y0) * 4, (x0 - xa) * 4:(x0 - xa) * 4 + (x1 - x0) * 4]
    return out


def run_job(job):
    if os.environ.get("OPNDUCK_TORCH_TEST_FAIL"):  # lets the app's fallback to ncnn be tested
        raise SystemExit("forced failure (test)")
    ffmpeg = job.get("ffmpeg", "ffmpeg")
    w, h, scale, fps = job["width"], job["height"], job["scale"], job["fps"]  # fps as "num/den"
    out_w, out_h = w * scale, h * scale
    device = "cuda" if torch.cuda.is_available() else ("mps" if torch.backends.mps.is_available() else None)  # mps: Apple silicon
    if device is None:
        raise SystemExit("No GPU is available to PyTorch (needs CUDA, or Metal on a Mac)")
    emit("STAGE loading-model")
    net = load_model(job["model"], job["weights"], device)
    if device == "cuda":
        torch.backends.cudnn.benchmark = True
    tile = job.get("tile") or 0

    enc_codec = {
        "libx264": ["-c:v", "libx264", "-preset", "medium"],
        "h264_nvenc": ["-c:v", "h264_nvenc", "-preset", "p5", "-cq", "28", "-b:v", "0"],
        "hevc_nvenc": ["-c:v", "hevc_nvenc", "-preset", "p5", "-cq", "30", "-b:v", "0"],
    }[job.get("encoder", "libx264")]
    dec = subprocess.Popen(
        [ffmpeg, "-v", "error", "-nostdin", "-i", job["input"], "-map", "0:v:0", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0)
    enc = subprocess.Popen(
        [ffmpeg, "-y", "-v", "error", "-nostdin", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{out_w}x{out_h}", "-framerate", fps, "-i", "-",
         "-i", job["input"], "-map", "0:v", "-map", "1:a?", *enc_codec,
         "-vf", "crop=trunc(iw/2)*2:trunc(ih/2)*2", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", job["output"]],
        stdin=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0)
    pump_stderr(dec, "decode")
    pump_stderr(enc, "encode")

    def stop_children(*_):
        # A cancel (SIGTERM) must not leave ffmpeg finishing a half-written file or running on its own.
        for p in (dec, enc):
            try:
                p.kill()
            except OSError:
                pass
        os._exit(143)

    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, stop_children)

    q_in, q_out = queue.Queue(maxsize=4), queue.Queue(maxsize=4)
    frame_bytes = w * h * 3

    def reader():
        while True:
            buf = dec.stdout.read(frame_bytes)
            while buf and len(buf) < frame_bytes:  # a pipe read may be short
                more = dec.stdout.read(frame_bytes - len(buf))
                if not more:
                    break
                buf += more
            if len(buf) < frame_bytes:
                q_in.put(None)
                return
            q_in.put(buf)

    def writer():
        while True:
            item = q_out.get()
            if item is None:
                return
            try:
                enc.stdin.write(item)
            except (BrokenPipeError, OSError):
                return

    tr, tw = threading.Thread(target=reader, daemon=True), threading.Thread(target=writer, daemon=True)
    tr.start()
    tw.start()
    emit("STAGE upscaling")
    total = max(1, job.get("frames", 1))
    done, last_report, t0 = 0, 0.0, time.time()
    with torch.inference_mode():
        while True:
            buf = q_in.get()
            if buf is None:
                break
            x = torch.frombuffer(bytearray(buf), dtype=torch.uint8).view(h, w, 3).to(device, non_blocking=True)
            x = x.permute(2, 0, 1).unsqueeze(0).half().div_(255).contiguous(memory_format=torch.channels_last)
            try:
                y = tiled(net, x, tile) if tile else net(x)
            except torch.cuda.OutOfMemoryError:
                torch.cuda.empty_cache()
                tile = tile or 256 if max(h, w) > 256 else 128  # fall back to tiles from now on
                y = tiled(net, x, tile)
            if scale != 4:
                y = F.interpolate(y.float(), size=(out_h, out_w), mode="bicubic", antialias=True, align_corners=False).half()
            out = y.clamp_(0, 1).mul_(255).round_().to(torch.uint8).squeeze(0).permute(1, 2, 0).contiguous().cpu().numpy().tobytes()
            q_out.put(out)
            done += 1
            now = time.time()
            if now - last_report > 0.25:
                emit(f"PROGRESS {min(0.99, done / total):.4f}")
                last_report = now
    q_out.put(None)
    tw.join()
    try:
        enc.stdin.close()
    except OSError:
        pass
    rc_enc = enc.wait()
    rc_dec = dec.wait()
    if rc_enc != 0:
        raise SystemExit(f"The encoder failed (exit {rc_enc})")
    if rc_dec != 0 and done == 0:
        raise SystemExit(f"The decoder failed (exit {rc_dec})")
    emit(f"STATS frames={done} seconds={time.time() - t0:.1f}")
    emit("PROGRESS 1")


if len(sys.argv) > 2 and sys.argv[1] == "--job":
    run_job(json.loads(sys.argv[2]))
