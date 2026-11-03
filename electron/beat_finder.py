# OPNduck — local-first media processing suite.
# Copyright (C) 2026 Aaron Jonsson. GPL-3.0-or-later (see LICENSE).
#
# Finds the tempo, beat times and musical key of a song, plus a waveform outline and the loudest "drops".
# Run by electron/core/beats.cjs as:  python beat_finder.py <audio file>
# Prints "@@STAGE <text>" and "@@PROGRESS <0..1>" lines while it works, then one "@@RESULT <json>" line.
import json
import sys

import numpy as np

# Krumhansl-Schmuckler key profiles (how much each pitch class matters in a major or minor key).
MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
# The DJ wheel (Camelot): number and letter for each key, major = B, minor = A.
CAMELOT_MAJOR = {"C": "8B", "G": "9B", "D": "10B", "A": "11B", "E": "12B", "B": "1B", "F#": "2B", "C#": "3B", "G#": "4B", "D#": "5B", "A#": "6B", "F": "7B"}
CAMELOT_MINOR = {"A": "8A", "E": "9A", "B": "10A", "F#": "11A", "C#": "12A", "G#": "1A", "D#": "2A", "A#": "3A", "F": "4A", "C": "5A", "G": "6A", "D": "7A"}


def say(kind: str, value) -> None:
    print(f"@@{kind} {value}", flush=True)


def detect_key(chroma_mean: np.ndarray):
    """The key whose profile fits the averaged pitch classes best: (name, mode, correlation)."""
    best = None
    for shift in range(12):
        for mode, profile in (("major", MAJOR), ("minor", MINOR)):
            r = float(np.corrcoef(chroma_mean, np.roll(profile, shift))[0, 1])
            if best is None or r > best[2]:
                best = (NAMES[shift], mode, r)
    return best


def peaks_of(y: np.ndarray, count: int = 800) -> list:
    """A waveform outline: the biggest swing in each of `count` equal blocks, scaled to 0..1."""
    block = max(1, len(y) // count)
    n = len(y) // block
    out = np.abs(y[: n * block]).reshape(n, block).max(axis=1)
    top = float(out.max()) or 1.0
    return [round(float(v) / top, 3) for v in out]


def find_drops(y: np.ndarray, sr: int, limit: int = 5) -> list:
    """Moments where the music suddenly gets much louder: the energy of the next 2 s against the previous 2 s."""
    hop = sr // 2
    rms = np.array([np.sqrt(np.mean(y[i : i + hop] ** 2)) for i in range(0, len(y) - hop, hop)])
    if len(rms) < 10:
        return []
    jump = np.array([rms[i : i + 4].mean() / (rms[max(0, i - 4) : i].mean() + 1e-6) if i >= 4 else 0.0 for i in range(len(rms) - 3)])
    found = []
    for i in np.argsort(jump)[::-1]:
        t = float(i * 0.5)
        if jump[i] < 1.6 or any(abs(t - f) < 8 for f in found):
            continue
        found.append(t)
        if len(found) >= limit:
            break
    return sorted(found)


def main(path: str) -> None:
    say("STAGE", "Loading the song")
    import librosa  # imported late: it is slow to load, and the install check runs this too

    y, sr = librosa.load(path, sr=22050, mono=True)
    if len(y) < sr * 3:
        raise RuntimeError("The song is shorter than 3 seconds.")
    say("PROGRESS", 0.25)
    say("STAGE", "Finding the beat")
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
    beats = [round(float(t), 3) for t in librosa.frames_to_time(beat_frames, sr=sr)]
    bpm = float(np.atleast_1d(tempo)[0])
    if len(beats) >= 8:
        # The tracker's tempo is rounded to a grid; the spacing of the beats it found is the finer number.
        spaced = 60.0 * (len(beats) - 1) / (beats[-1] - beats[0])  # the average spacing over the whole song
        if abs(spaced - bpm) / bpm < 0.08:
            bpm = spaced
    say("PROGRESS", 0.6)
    say("STAGE", "Finding the key")
    chroma = librosa.feature.chroma_cqt(y=librosa.effects.harmonic(y), sr=sr)
    name, mode, strength = detect_key(chroma.mean(axis=1))
    say("PROGRESS", 0.9)
    result = {
        "duration": round(len(y) / sr, 3),
        "bpm": round(bpm, 1),
        "beats": beats,
        "key": f"{name} {mode}",
        "camelot": (CAMELOT_MAJOR if mode == "major" else CAMELOT_MINOR)[name],
        "keyStrength": round(strength, 2),
        "peaks": peaks_of(y),
        "drops": find_drops(y, sr),
    }
    say("RESULT", json.dumps(result))


if __name__ == "__main__":
    try:
        main(sys.argv[1])
    except Exception as err:  # the caller shows this text
        print(f"@@FAIL {err}", flush=True)
        sys.exit(1)
