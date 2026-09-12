"""Generates a small, fully synthetic "song" fixture for tests: a spoken
lyric line synthesized with the local TTS engine (pyttsx3 -> SAPI5 on
Windows, NSSpeechSynthesizer on macOS, espeak on Linux) mixed under a
synthesized backing chord, plus a JSON file with the expected words/timing
tolerance. No copyrighted or downloaded material is used, per the test
media requirements in README.md.

Run with: python fixtures/generate_fixture.py
"""

from __future__ import annotations

import json
import os

import numpy as np
import pyttsx3
import soundfile as sf

FIXTURE_DIR = os.path.dirname(__file__)
LYRIC_TEXT = "the sun will rise again tomorrow"
SAMPLE_RATE = 22050


def synthesize_speech(text: str, out_path: str) -> None:
    engine = pyttsx3.init()
    engine.setProperty("rate", 150)
    for voice in engine.getProperty("voices"):
        if "en-us" in voice.id.lower() or "english" in voice.name.lower():
            engine.setProperty("voice", voice.id)
            break
    engine.save_to_file(text, out_path)
    engine.runAndWait()


def make_backing_track(duration_sec: float, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    """A quiet sustained C-major triad, standing in for an instrumental bed."""
    t = np.linspace(0, duration_sec, int(sample_rate * duration_sec), endpoint=False)
    chord = sum(0.03 * np.sin(2 * np.pi * f * t) for f in (261.63, 329.63, 392.0))
    return chord


def main() -> None:
    os.makedirs(FIXTURE_DIR, exist_ok=True)
    speech_path = os.path.join(FIXTURE_DIR, "_speech_raw.wav")
    synthesize_speech(LYRIC_TEXT, speech_path)

    speech, sr = sf.read(speech_path)
    if speech.ndim > 1:
        speech = speech.mean(axis=1)
    if sr != SAMPLE_RATE:
        import librosa

        speech = librosa.resample(speech.astype(np.float64), orig_sr=sr, target_sr=SAMPLE_RATE)

    backing = make_backing_track(len(speech) / SAMPLE_RATE + 0.5)
    mixed = np.zeros(max(len(speech), len(backing)))
    mixed[: len(backing)] += backing
    mixed[: len(speech)] += speech

    peak = np.max(np.abs(mixed)) or 1.0
    mixed = mixed / peak * 0.9

    out_path = os.path.join(FIXTURE_DIR, "synthetic_song.wav")
    sf.write(out_path, mixed, SAMPLE_RATE)

    with open(os.path.join(FIXTURE_DIR, "synthetic_song.json"), "w", encoding="utf-8") as fh:
        json.dump({"expectedWords": LYRIC_TEXT.split(), "durationSec": len(mixed) / SAMPLE_RATE}, fh, indent=2)

    os.remove(speech_path)
    print(f"Wrote {out_path} ({len(mixed) / SAMPLE_RATE:.2f}s)")


if __name__ == "__main__":
    main()
