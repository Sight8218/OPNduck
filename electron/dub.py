# OPNduck — local-first media processing suite.
# Copyright (C) 2026 Aaron Jonsson. GPL-3.0-or-later (see LICENSE).
#
# Local dubbing, the speech part: transcribe the vocals (faster-whisper), translate each line (Argos Translate, offline),
# speak it (Piper, offline), fit each spoken line into the time of the original line, and mix them over the music and
# effects. Run by electron/core/dub.cjs as:  python dub.py <job.json>
# Prints "@@STAGE <text>", "@@PROGRESS <0..1>", then "@@DONE" or "@@FAIL <why>". Voice cloning is out of scope on purpose.
import json
import os
import subprocess
import sys
import urllib.request
import wave

import numpy as np

RATE = 44100
# One Piper voice per target language (all free voices from rhasspy/piper-voices).
VOICES = {
    "en": "en/en_US/lessac/medium/en_US-lessac-medium",
    "sv": "sv/sv_SE/nst/medium/sv_SE-nst-medium",
    "de": "de/de_DE/thorsten/medium/de_DE-thorsten-medium",
    "fr": "fr/fr_FR/siwis/medium/fr_FR-siwis-medium",
    "es": "es/es_ES/davefx/medium/es_ES-davefx-medium",
    "it": "it/it_IT/paola/medium/it_IT-paola-medium",
}
VOICE_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main/"
MIN_TEMPO, MAX_TEMPO = 0.8, 1.35  # how far a spoken line may be sped up or slowed to fit its slot


def say(kind, value=""):
    print(f"@@{kind} {value}".rstrip(), flush=True)


def fetch(url, dest):
    if os.path.exists(dest):
        return dest
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    urllib.request.urlretrieve(url, dest + ".part")
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


def speak(voice_dir, lang, text, out_wav):
    from piper import PiperVoice

    rel = VOICES[lang]
    base = os.path.join(voice_dir, os.path.basename(rel))
    fetch(VOICE_URL + rel + ".onnx", base + ".onnx")
    fetch(VOICE_URL + rel + ".onnx.json", base + ".onnx.json")
    voice = PiperVoice.load(base + ".onnx")
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
