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

stdout protocol, one line each, parsed by main.cjs:
  STAGE loading-model | transcribing
  LANG <code>
  PROGRESS <0-1>
Errors go to stderr; the last stderr line becomes the task's error message.
"""

import sys


def timestamp(seconds, sep):
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}{sep}{ms:03d}"


def emit(line):
    print(line, flush=True)


def transcribe(model_name, device, compute_type, input_path, language):
    from faster_whisper import WhisperModel

    emit("STAGE loading-model")
    model = WhisperModel(model_name, device=device, compute_type=compute_type)
    segments, info = model.transcribe(input_path, language=language, vad_filter=True)
    emit(f"LANG {info.language}")
    emit("STAGE transcribing")
    return segments, info.duration or 0


def main():
    input_path, output_path, model_name, language, fmt = sys.argv[1:6]
    language = None if language == "auto" else language

    try:
        import faster_whisper  # noqa: F401
    except ImportError:
        sys.stderr.write("faster-whisper isn't installed for this Python\n")
        sys.exit(2)

    # "auto" picks CUDA when it's there; a half-working CUDA install (no cuDNN,
    # say) only fails once decoding starts, so retry on CPU if nothing came out yet.
    attempts = [("auto", "default"), ("cpu", "int8")]
    cues = []
    for i, (device, compute_type) in enumerate(attempts):
        stage = "load the model (its first use downloads it from Hugging Face)"
        try:
            segments, duration = transcribe(model_name, device, compute_type, input_path, language)
            stage = "transcribe"
            for seg in segments:
                text = seg.text.strip()
                if text:
                    cues.append((seg.start, seg.end, text))
                if duration > 0:
                    emit(f"PROGRESS {min(1.0, seg.end / duration):.4f}")
            break
        except Exception as err:  # noqa: BLE001 — any backend failure is worth one CPU retry
            if cues or i == len(attempts) - 1:
                sys.stderr.write(f"Couldn't {stage}: {err}\n")
                sys.exit(1)

    with open(output_path, "w", encoding="utf-8") as out:
        if fmt == "vtt":
            out.write("WEBVTT\n\n")
            for start, end, text in cues:
                out.write(f"{timestamp(start, '.')} --> {timestamp(end, '.')}\n{text}\n\n")
        else:
            for n, (start, end, text) in enumerate(cues, 1):
                out.write(f"{n}\n{timestamp(start, ',')} --> {timestamp(end, ',')}\n{text}\n\n")

    emit("PROGRESS 1")


if __name__ == "__main__":
    main()
