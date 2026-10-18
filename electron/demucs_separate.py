# OPNduck — local-first media processing suite.
# Copyright (C) 2026 Aaron Jonsson. GPL-3.0-or-later (see LICENSE).
#
# Splits a stereo 44.1 kHz WAV into "vocals" and "no_vocals" with Demucs (htdemucs), using
# soundfile for audio I/O instead of torchaudio's loaders (those need extra backends on recent
# torch). Run by electron/main.cjs as:  python -c <this script> <in.wav> <out dir>
#
# Writes <out dir>/vocals.wav and <out dir>/no_vocals.wav. Progress is the tqdm percentage Demucs
# prints on stderr; the model (~80 MB) downloads once into the user's torch cache.
import sys

import numpy as np
import soundfile as sf
import torch
from demucs.apply import apply_model
from demucs.pretrained import get_model


def main(src: str, out_dir: str) -> None:
    wav, sr = sf.read(src, dtype="float32", always_2d=True)  # (samples, channels)
    model = get_model("htdemucs")
    model.eval()
    if sr != model.samplerate or wav.shape[1] != model.audio_channels:
        raise SystemExit(f"expected {model.samplerate} Hz x{model.audio_channels}, got {sr} Hz x{wav.shape[1]}")

    mix = torch.from_numpy(np.ascontiguousarray(wav.T))  # (channels, samples)
    ref = mix.mean(0)
    mix = (mix - ref.mean()) / (ref.std() + 1e-8)  # the normalisation Demucs was trained with

    def run(device: str):
        return apply_model(model, mix[None], device=device, progress=True, split=True, overlap=0.25)[0]

    try:
        sources = run("cuda" if torch.cuda.is_available() else "cpu")
    except RuntimeError as err:  # e.g. CUDA out of memory: retry on the CPU rather than fail the job
        if "out of memory" not in str(err).lower():
            raise
        torch.cuda.empty_cache()
        sources = run("cpu")

    sources = sources * (ref.std() + 1e-8) + ref.mean()
    names = list(model.sources)
    vocals = sources[names.index("vocals")]
    rest = sum(sources[i] for i, name in enumerate(names) if name != "vocals")
    sf.write(f"{out_dir}/vocals.wav", vocals.T.cpu().numpy(), sr, subtype="PCM_24")
    sf.write(f"{out_dir}/no_vocals.wav", rest.T.cpu().numpy(), sr, subtype="PCM_24")


main(sys.argv[1], sys.argv[2])
