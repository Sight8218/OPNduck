# OPNduck — local-first media processing suite.
# Copyright (C) 2026 Aaron Jonsson. GPL-3.0-or-later (see LICENSE).
#
# Local dubbing, the speech part: transcribe the vocals (faster-whisper), translate each line (Argos Translate, offline),
# speak it (Piper, offline), fit each spoken line into the time of the original line, and mix them over the music and
# effects. Run by electron/core/dub.cjs as:  python dub.py <job.json>
# Prints "@@STAGE <text>", "@@PROGRESS <0..1>", then "@@DONE" or "@@FAIL <why>". Voice cloning is out of scope on purpose.
import hashlib
import json
import os
import signal
import subprocess
import sys
import urllib.request
import wave

import numpy as np


def _stop(*_):
    # Canceled: leave at once; FFmpeg runs here are short and end with the pipe closing.
    os._exit(143)


signal.signal(signal.SIGTERM, _stop)

RATE = 44100
# One Piper voice per target language (all free voices from rhasspy/piper-voices).
# Voices from rhasspy/piper-voices at one fixed revision, each file checked against its SHA-256 after downloading.
VOICES = {
    "en": ("en/en_US/lessac/medium/en_US-lessac-medium", "5efe09e69902187827af646e1a6e9d269dee769f9877d17b16b1b46eeaaf019f", "efe19c417bed055f2d69908248c6ba650fa135bc868b0e6abb3da181dab690a0"),
    "sv": ("sv/sv_SE/nst/medium/sv_SE-nst-medium", "df011f56825a59dd1efc080c38a65a1ef70407e60f63050e9246f43a3d7e471e", "d45dd74cbb4eca58694bf04a97e243044092476f28a55ae26424f0653086980a"),
    "de": ("de/de_DE/thorsten/medium/de_DE-thorsten-medium", "7e64762d8e5118bb578f2eea6207e1a35a8e0c30595010b666f983fc87bb7819", "974adee790533adb273a1ac88f49027d2a1b8f0f2cf4905954a4791e79264e85"),
    "fr": ("fr/fr_FR/siwis/medium/fr_FR-siwis-medium", "641d1ab097da2b81128c076810edb052b385decc8be3381814802a64a73baf99", "39479916c2db192b5ac9764daddd0c744d83e023ad890c6976c0633ae4df8959"),
    "es": ("es/es_ES/davefx/medium/es_ES-davefx-medium", "6658b03b1a6c316ee4c265a9896abc1393353c2d9e1bca7d66c2c442e222a917", "0e0dda87c732f6f38771ff274a6380d9252f327dca77aa2963d5fbdf9ec54842"),
    "it": ("it/it_IT/paola/medium/it_IT-paola-medium", "6fc918b5a0ea6137382833dddfa567bffbe6a5060c02043c87192ee59c04210c", "aea19c0a7fce29fbc359b93f10e7902854401e4c95ae2ea328ae516b15d296cf"),
}
VOICE_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/e7229f7d33a10e145e109b886d661984201ac3c4/"
MIN_TEMPO, MAX_TEMPO = 0.8, 1.35  # how far a spoken line may be sped up or slowed to fit its slot


def say(kind, value=""):
    print(f"@@{kind} {value}".rstrip(), flush=True)


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def fetch(url, dest, sha256):
    if os.path.exists(dest) and sha256_of(dest) == sha256:
        return dest
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    urllib.request.urlretrieve(url, dest + ".part")
    if sha256_of(dest + ".part") != sha256:
        os.remove(dest + ".part")
        raise RuntimeError("A downloaded voice file did not match its published checksum, so it was not used")
    os.replace(dest + ".part", dest)
    return dest


def transcribe(vocals, model_name, language):
    from faster_whisper import WhisperModel

    # Decoded with FFmpeg and handed over as numbers: faster-whisper's own reader depends on a PyAV feature that newer PyAV lacks.
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", vocals, "-f", "f32le", "-ac", "1", "-ar", "16000", "-"], stdout=subprocess.PIPE, check=True).stdout
    vocals = np.frombuffer(raw, dtype=np.float32)
    device, compute = ("cpu", "int8") if sys.platform == "darwin" else ("auto", "default")
    try:
        model = WhisperModel(model_name, device=device, compute_type=compute)
        segments, info = model.transcribe(vocals, language=None if language in (None, "", "auto") else language, vad_filter=True)
        out = [(s.start, s.end, s.text.strip()) for s in segments if s.text.strip()]
    except Exception:  # a half-working GPU setup: once more on the processor
        model = WhisperModel(model_name, device="cpu", compute_type="int8")
        segments, info = model.transcribe(vocals, language=None if language in (None, "", "auto") else language, vad_filter=True)
        out = [(s.start, s.end, s.text.strip()) for s in segments if s.text.strip()]
    return out, info.language


def translator(src, dst):
    """A function text -> text for src -> dst. Language packs download once (about 100 MB per pair); through English when needed."""
    from argostranslate import package, translate

    if src == dst:
        return lambda t: t
    installed = {(l.code, t.code) for l in translate.get_installed_languages() for t in [x.to_lang for x in l.translations_from]}

    def need(a, b):
        if (a, b) in installed:
            return
        say("STAGE", f"Downloading the {a} to {b} translation (once)")
        package.update_package_index()
        pkg = next((p for p in package.get_available_packages() if p.from_code == a and p.to_code == b), None)
        if pkg is None:
            raise RuntimeError(f"There is no offline translation from {a} to {b}")
        package.install_from_path(pkg.download())
        installed.add((a, b))

    try:
        need(src, dst)
        pairs = [(src, dst)]
    except RuntimeError:
        need(src, "en")
        need("en", dst)
        pairs = [(src, "en"), ("en", dst)]
    langs = {l.code: l for l in translate.get_installed_languages()}
    steps = [langs[a].get_translation(langs[b]) for a, b in pairs]

    def run(text):
        for s in steps:
            text = s.translate(text)
        return text

    return run


_loaded_voices = {}


def speak(voice_dir, lang, text, out_wav):
    from piper import PiperVoice

    rel, onnx_sha, json_sha = VOICES[lang]
    base = os.path.join(voice_dir, os.path.basename(rel))
    voice = _loaded_voices.get(base)
    if voice is None:  # loading the model once per language, not once per spoken line
        fetch(VOICE_URL + rel + ".onnx", base + ".onnx", onnx_sha)
        fetch(VOICE_URL + rel + ".onnx.json", base + ".onnx.json", json_sha)
        voice = _loaded_voices[base] = PiperVoice.load(base + ".onnx")
    with wave.open(out_wav, "wb") as w:
        voice.synthesize_wav(text, w)
    return out_wav


def read_wav(path):
    """Mono float samples at RATE from any audio file, through FFmpeg."""
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", str(RATE), "-"], stdout=subprocess.PIPE, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def fit(samples, slot, room):
    """Speeds a spoken line up or slows it down to fit `slot` seconds; if it still runs long it may overrun into the gap
    after it (`room` more seconds) and is cut off beyond that."""
    have = len(samples) / RATE
    if have <= 0:
        return samples
    tempo = min(MAX_TEMPO, max(MIN_TEMPO, have / max(slot, 0.2)))
    if abs(tempo - 1) > 0.02:
        raw = subprocess.run(["ffmpeg", "-v", "error", "-f", "f32le", "-ar", str(RATE), "-ac", "1", "-i", "-", "-filter:a", f"atempo={tempo:.4f}", "-f", "f32le", "-"], input=samples.tobytes(), stdout=subprocess.PIPE, check=True).stdout
        samples = np.frombuffer(raw, dtype=np.float32)
    return samples[: int((slot + room) * RATE)]


def main(job):
    work = job["workDir"]
    say("STAGE", "Listening to the voice")
    segments, source = transcribe(job["vocals"], job.get("whisperModel", "base"), job.get("source", "auto"))
    if not segments:
        raise RuntimeError("No speech was found in this video")
    say("PROGRESS", "0.25")
    target = job["target"]
    if target not in VOICES:
        raise RuntimeError(f"There is no voice for the language {target}")
    translate = translator(source, target)
    total = max(float(job["duration"]), segments[-1][1])
    track = np.zeros(int((total + 3) * RATE), dtype=np.float32)
    say("STAGE", "Translating and speaking")
    for i, (start, end, text) in enumerate(segments):
        line = translate(text)
        if not line.strip():
            continue
        wav = speak(job["voiceDir"], target, line, os.path.join(work, f"line{i}.wav"))
        nxt = segments[i + 1][0] if i + 1 < len(segments) else total
        samples = fit(read_wav(wav), end - start, max(0.0, nxt - end - 0.05))
        at = int(start * RATE)
        track[at : at + len(samples)] += samples[: len(track) - at]
        say("PROGRESS", f"{0.25 + 0.6 * (i + 1) / len(segments):.4f}")
    peak = float(np.abs(track).max()) or 1.0
    track = track / max(1.0, peak * 1.05)
    speech = os.path.join(work, "speech.f32")
    track.tofile(speech)
    say("STAGE", "Mixing")
    # The voice goes over the music and effects, which dip while it speaks; the old voice can stay far underneath.
    keep = float(job.get("keepOriginalDb", 0))
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(RATE), "-ac", "1", "-i", speech, "-i", job["music"]]
    graph = "[0]asplit[v][sc];[1]aformat=channel_layouts=stereo[m];[m][sc]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=300[duck]"
    if keep < 0:
        cmd += ["-i", job["vocals"]]
        graph += f";[2]volume={keep}dB[old];[duck][old]amix=inputs=2:normalize=0[bed];[bed][v]amix=inputs=2:normalize=0:duration=longest[out]"
    else:
        graph += ";[duck][v]amix=inputs=2:normalize=0:duration=longest[out]"
    subprocess.run(cmd + ["-filter_complex", graph, "-map", "[out]", "-ar", str(RATE), "-ac", "2", job["output"]], check=True)
    say("PROGRESS", "1")
    say("RESULT", json.dumps({"source": source, "lines": len(segments)}))
    say("DONE")


if __name__ == "__main__":
    try:
        main(json.load(open(sys.argv[1])))
    except Exception as err:  # the caller shows this text
        say("FAIL", err)
        sys.exit(1)
