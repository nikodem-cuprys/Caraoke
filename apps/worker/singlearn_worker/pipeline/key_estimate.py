"""Estimates the song's musical key using the classic Krumhansl-Schmuckler
key-finding algorithm: correlate the song's aggregate chroma (pitch-class
energy distribution) against the Krumhansl-Kessler major/minor key
profiles, for all 24 candidate keys, and take the best correlation.
This is a well-known, simple, explainable approach appropriate for an
estimate the UI presents as such (confidence = the correlation margin
between the best and second-best candidate, not a hard guarantee)."""

from __future__ import annotations

from dataclasses import dataclass

import librosa
import numpy as np

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Krumhansl-Kessler key profiles.
MAJOR_PROFILE = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR_PROFILE = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


@dataclass
class KeyEstimate:
    tonic: str
    mode: str
    confidence: float


def estimate_key(audio: np.ndarray, sample_rate: int) -> KeyEstimate:
    chroma = librosa.feature.chroma_cqt(y=audio, sr=sample_rate)
    chroma_mean = chroma.mean(axis=1)

    candidates: list[tuple[str, str, float]] = []
    for shift in range(12):
        major_corr = np.corrcoef(chroma_mean, np.roll(MAJOR_PROFILE, shift))[0, 1]
        minor_corr = np.corrcoef(chroma_mean, np.roll(MINOR_PROFILE, shift))[0, 1]
        candidates.append((NOTE_NAMES[shift], "major", float(major_corr)))
        candidates.append((NOTE_NAMES[shift], "minor", float(minor_corr)))

    candidates.sort(key=lambda c: c[2], reverse=True)
    best_tonic, best_mode, best_score = candidates[0]
    second_score = candidates[1][2]
    confidence = max(0.0, min(1.0, (best_score - second_score) * 2 + 0.4))

    return KeyEstimate(tonic=best_tonic, mode=best_mode, confidence=confidence)
