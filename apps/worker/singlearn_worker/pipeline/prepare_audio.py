"""PREPARE_AUDIO stage: normalize whatever the user uploaded into a
consistent WAV format (44.1kHz, stereo, 16-bit PCM) with single-pass loudness
normalization, so every downstream stage (separation, transcription, pitch
detection) operates on a predictable, well-behaved input and all derived
assets share one sample-accurate timeline.
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass


@dataclass
class PreparedAudio:
    path: str
    duration_sec: float
    sample_rate: int = 44100
    channels: int = 2


class AudioPreparationError(RuntimeError):
    pass


def prepare_audio(input_path: str, output_path: str) -> PreparedAudio:
    """Runs ffmpeg to resample/normalize input_path into output_path.

    Uses the single-pass `loudnorm` filter (EBU R128) rather than a two-pass
    measure+apply, trading a small amount of normalization accuracy for a
    much simpler, faster pipeline stage — acceptable because the karaoke
    player's own vocals/instrumental mixer lets the user adjust levels
    anyway.
    """
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        input_path,
        "-ar",
        "44100",
        "-ac",
        "2",
        "-af",
        "loudnorm=I=-16:TP=-1.5:LRA=11",
        "-c:a",
        "pcm_s16le",
        output_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise AudioPreparationError(f"ffmpeg failed: {result.stderr[-2000:]}")

    duration = _probe_duration(output_path)
    return PreparedAudio(path=output_path, duration_sec=duration)


def _probe_duration(path: str) -> float:
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise AudioPreparationError(f"ffprobe failed: {result.stderr[-2000:]}")
    return float(result.stdout.strip())
