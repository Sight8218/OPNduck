# OPNduck — local-first media processing suite.
# Copyright (C) 2026 Aaron Jonsson
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program. If not, see <https://www.gnu.org/licenses/>.

"""Subtitle generation via faster-whisper. main.cjs runs this with the user's
own Python (faster-whisper is a Python library, not a CLI), passing the source
as `python -c <this file> input output model language format`.

Worker mode: `python -c <this file> --serve` keeps the loaded model between files and reads one JSON request
per stdin line ({"input","output","model","language","format"}), answering "@@DONE" or "@@FAIL <message>"
after the protocol lines below.

stdout protocol, one line each, parsed by main.cjs:
  STAGE loading-model | transcribing
  LANG <code>
  PROGRESS <0-1>
Errors go to stderr; the last stderr line becomes the task's error message.
"""

import gc
import json
import sys


def timestamp(seconds, sep):
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}{sep}{ms:03d}"


def emit(line):
    print(line, flush=True)


_MODELS = {}
_START_ATTEMPT = 0  # in worker mode: once a backend worked (or CUDA failed), later files start there


class JobError(Exception):
    pass


def decode_audio(input_path):
    """16 kHz mono float32 samples via ffmpeg. faster-whisper's own decoder goes through PyAV, and a
    PyAV that doesn't match it (a distro package a version off) fails every file; ffmpeg is already
    required by OPNduck. Falls back to the path (faster-whisper's decoder) if ffmpeg can't be run."""
    try:
        import subprocess

        import numpy as np

        out = subprocess.run(
            ["ffmpeg", "-v", "error", "-nostdin", "-i", input_path, "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
            capture_output=True,
            check=True,
        ).stdout
        if out:
            return np.frombuffer(out, dtype=np.float32)
    except Exception:  # noqa: BLE001 — any failure just means "use the built-in decoder"
        pass
    return input_path


def transcribe(model_name, device, compute_type, input_path, language, vad=True, translate=False):
    from faster_whisper import WhisperModel

    emit("STAGE loading-model")
    key = (model_name, device, compute_type)
    if key not in _MODELS:
        _MODELS.clear()  # only one model stays loaded: it can hold gigabytes of GPU memory
        gc.collect()
        _MODELS[key] = WhisperModel(model_name, device=device, compute_type=compute_type)
    model = _MODELS[key]
    segments, info = model.transcribe(decode_audio(input_path), language=language, vad_filter=vad, task="translate" if translate else "transcribe")
    emit(f"LANG {info.language}")
    emit("STAGE transcribing")
    return segments, info.duration or 0


def run_job(input_path, output_path, model_name, language, fmt, translate=False):
    """Transcribes one file; raises JobError with the message to show the user."""
    language = None if language == "auto" else language

    try:
        import faster_whisper  # noqa: F401
    except ImportError:
        raise JobError("faster-whisper isn't installed for this Python") from None

    # "auto" picks CUDA when it's there; a half-working CUDA install (no cuDNN,
    # say) only fails once decoding starts, so retry on CPU if nothing came out yet.
    attempts = [("auto", "default"), ("cpu", "int8")]
    if sys.platform == "darwin":
        attempts = [("cpu", "int8")]  # faster-whisper has no Metal backend
    cues = []
    global _START_ATTEMPT
    for i in range(_START_ATTEMPT, len(attempts)):
        device, compute_type = attempts[i]
        stage = "load the model or read the audio (the model is downloaded from Hugging Face on first use)"
        try:
            # The speech filter drops singing over music entirely, so if it leaves nothing, try
            # once more without it before concluding there is no speech.
            for vad in (True, False):
                segments, duration = transcribe(model_name, device, compute_type, input_path, language, vad, translate)
                stage = "transcribe"
                for seg in segments:
                    text = seg.text.strip()
                    if text:
                        cues.append((seg.start, seg.end, text))
                    if duration > 0:
                        emit(f"PROGRESS {min(1.0, seg.end / duration):.4f}")
                if cues:
                    break
            _START_ATTEMPT = i
            break
        except Exception as err:  # noqa: BLE001 — any backend failure is worth one CPU retry
            if cues or i == len(attempts) - 1:
                raise JobError(f"Couldn't {stage}: {err}") from None

    if not cues:
        raise JobError("No speech was found in this file.")

    with open(output_path, "w", encoding="utf-8") as out:
        if fmt == "vtt":
            out.write("WEBVTT\n\n")
            for start, end, text in cues:
                out.write(f"{timestamp(start, '.')} --> {timestamp(end, '.')}\n{text}\n\n")
        else:
            for n, (start, end, text) in enumerate(cues, 1):
                out.write(f"{n}\n{timestamp(start, ',')} --> {timestamp(end, ',')}\n{text}\n\n")

    emit("PROGRESS 1")


def serve():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            r = json.loads(line)
            run_job(r["input"], r["output"], r["model"], r["language"], r["format"], bool(r.get("translate")))
            emit("@@DONE")
        except JobError as err:
            emit(f"@@FAIL {err}")
        except Exception as err:  # noqa: BLE001 — keep the worker (and its model) alive
            emit(f"@@FAIL {err}")


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--serve":
        serve()
        return
    input_path, output_path, model_name, language, fmt = sys.argv[1:6]
    try:
        run_job(input_path, output_path, model_name, language, fmt)
    except JobError as err:
        sys.stderr.write(f"{err}\n")
        sys.exit(2 if "isn't installed" in str(err) else 1)


if __name__ == "__main__":
    main()
