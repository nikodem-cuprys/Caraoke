"""GENERATE_WAVEFORM stage: downsample the reference mix into a small peak
array the player can render immediately and use for click-to-seek, instead
of shipping the whole audio buffer to the browser just to draw a shape."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

TARGET_PEAKS_PER_SEC = 20
MAX_PEAKS = 6000


@dataclass
class Waveform:
    sample_rate_hz: int
    peaks: list[float]
    duration_sec: float


def generate_waveform(audio: np.ndarray, sample_rate: int) -> Waveform:
    if audio.ndim > 1:
        # soundfile reads multichannel audio as (n_frames, n_channels), so
        # downmixing to mono means averaging across axis=1, not axis=0
        # (which would instead collapse the frames axis and destroy the
        # waveform entirely).
        audio = audio.mean(axis=1)

    duration_sec = len(audio) / sample_rate
    target_points = min(MAX_PEAKS, max(1, int(duration_sec * TARGET_PEAKS_PER_SEC)))
    bucket_size = max(1, len(audio) // target_points)

    peaks: list[float] = []
    for start in range(0, len(audio), bucket_size):
        bucket = audio[start : start + bucket_size]
        if len(bucket) == 0:
            continue
        peaks.append(float(np.max(np.abs(bucket))))

    max_peak = max(peaks) if peaks else 1.0
    if max_peak > 0:
        peaks = [p / max_peak for p in peaks]

    effective_rate = len(peaks) / duration_sec if duration_sec > 0 else TARGET_PEAKS_PER_SEC
    return Waveform(sample_rate_hz=round(effective_rate, 3), peaks=peaks, duration_sec=duration_sec)
