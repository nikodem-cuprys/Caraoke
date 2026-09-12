"""DETECT_PITCH stage.

Uses librosa's `pyin` (probabilistic YIN) estimator. pyin was chosen over
CREPE/torchcrepe/RMVPE for the MVP because it needs no pretrained model
download, runs entirely on CPU via numpy/scipy, and its probabilistic
voiced/unvoiced output plus per-frame voice probability map directly onto
the confidence values this app requires to avoid presenting silence or
unvoiced consonants as pitched singing. It is a well-established,
maintained algorithm for monophonic pitch tracking including singing voice;
swapping in a neural estimator (torchcrepe, RMVPE) later means only
reimplementing `estimate_pitch_contour` behind the same return shape.
"""

from __future__ import annotations

from dataclasses import dataclass

import librosa
import numpy as np

# Singing voice range: roughly C2 (65Hz, low bass) to C6 (1047Hz, high soprano/falsetto).
DEFAULT_FMIN_HZ = 65.0
DEFAULT_FMAX_HZ = 1047.0
DEFAULT_HOP_LENGTH = 512


@dataclass
class PitchFrame:
    t: float
    frequency_hz: float | None
    confidence: float
    voiced: bool


def estimate_pitch_contour(
    audio: np.ndarray,
    sample_rate: int,
    fmin_hz: float = DEFAULT_FMIN_HZ,
    fmax_hz: float = DEFAULT_FMAX_HZ,
    hop_length: int = DEFAULT_HOP_LENGTH,
) -> list[PitchFrame]:
    f0, voiced_flag, voiced_prob = librosa.pyin(
        audio,
        fmin=fmin_hz,
        fmax=fmax_hz,
        sr=sample_rate,
        hop_length=hop_length,
    )
    times = librosa.times_like(f0, sr=sample_rate, hop_length=hop_length)

    frames: list[PitchFrame] = []
    for t, freq, voiced, prob in zip(times, f0, voiced_flag, voiced_prob, strict=True):
        is_voiced = bool(voiced) and not np.isnan(freq)
        frames.append(
            PitchFrame(
                t=float(t),
                frequency_hz=float(freq) if is_voiced else None,
                confidence=float(prob) if not np.isnan(prob) else 0.0,
                voiced=is_voiced,
            )
        )
    return frames


def smooth_pitch_contour(frames: list[PitchFrame], median_window: int = 5) -> list[PitchFrame]:
    """Applies a short median filter across voiced frequency values to
    remove single-frame octave-jump/tracking errors, while keeping the
    window small enough (default 5 frames, ~58ms at the default hop) to
    preserve genuine vibrato, which typically cycles every 120-200ms.
    Unvoiced frames and gaps are left untouched — smoothing never manufactures
    pitch where there was none.
    """
    if median_window < 1 or median_window % 2 == 0:
        raise ValueError("median_window must be a positive odd integer")

    frequencies = [f.frequency_hz for f in frames]
    half = median_window // 2
    smoothed: list[PitchFrame] = []

    for i, frame in enumerate(frames):
        if not frame.voiced or frame.frequency_hz is None:
            smoothed.append(frame)
            continue

        window_values = []
        for j in range(max(0, i - half), min(len(frames), i + half + 1)):
            if frames[j].voiced and frequencies[j] is not None:
                window_values.append(frequencies[j])

        if not window_values:
            smoothed.append(frame)
            continue

        median_value = float(np.median(window_values))
        smoothed.append(
            PitchFrame(t=frame.t, frequency_hz=median_value, confidence=frame.confidence, voiced=frame.voiced)
        )

    return smoothed
