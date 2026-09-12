"""Integration-style tests that exercise the real librosa-based pitch
detection, waveform generation, and key estimation against synthesized
audio (no copyrighted material, no network, fully deterministic)."""

import numpy as np
import pytest

from singlearn_worker.music_theory import hz_to_midi
from singlearn_worker.pipeline.detect_pitch import (
    estimate_pitch_contour,
    smooth_pitch_contour,
)
from singlearn_worker.pipeline.key_estimate import estimate_key
from singlearn_worker.pipeline.waveform import generate_waveform


def sine_tone(freq_hz: float, duration_sec: float, sample_rate: int = 22050) -> np.ndarray:
    t = np.linspace(0, duration_sec, int(sample_rate * duration_sec), endpoint=False)
    return 0.5 * np.sin(2 * np.pi * freq_hz * t)


def test_pitch_detection_recovers_a4_from_a_pure_tone():
    sample_rate = 22050
    audio = sine_tone(440.0, 1.0, sample_rate)
    frames = estimate_pitch_contour(audio, sample_rate)

    voiced_frames = [f for f in frames if f.voiced and f.frequency_hz]
    assert len(voiced_frames) > 5

    # Ignore the first/last couple of frames, where pyin's analysis window
    # still overlaps silence at the tone's edges.
    steady_frames = voiced_frames[3:-3] if len(voiced_frames) > 6 else voiced_frames
    midis = [hz_to_midi(f.frequency_hz) for f in steady_frames]
    assert np.mean(midis) == pytest.approx(69, abs=0.5)


def test_pitch_detection_reports_silence_as_unvoiced():
    sample_rate = 22050
    audio = np.zeros(sample_rate)  # 1 second of pure silence
    frames = estimate_pitch_contour(audio, sample_rate)
    voiced_count = sum(1 for f in frames if f.voiced)
    # pyin may very occasionally flag a near-silent frame; require the
    # overwhelming majority to be correctly reported as unvoiced.
    assert voiced_count / len(frames) < 0.1


def test_smoothing_pipeline_runs_end_to_end_on_real_pitch_output():
    sample_rate = 22050
    audio = sine_tone(220.0, 0.5, sample_rate)
    frames = estimate_pitch_contour(audio, sample_rate)
    smoothed = smooth_pitch_contour(frames)
    assert len(smoothed) == len(frames)


def test_waveform_generation_produces_normalized_peaks():
    sample_rate = 22050
    audio = sine_tone(220.0, 3.0, sample_rate) * 0.3
    waveform = generate_waveform(audio, sample_rate)
    assert waveform.duration_sec == pytest.approx(3.0, abs=0.01)
    assert len(waveform.peaks) > 10
    assert max(waveform.peaks) <= 1.0 + 1e-6
    assert max(waveform.peaks) > 0.9  # normalized so the loudest bucket approaches 1.0


def test_waveform_generation_handles_stereo_audio_shaped_like_soundfile_output():
    # soundfile.read() returns multichannel audio as (n_frames, n_channels)
    # -- regression test for a bug where downmixing averaged over the wrong
    # axis and collapsed the whole waveform to a couple of points.
    sample_rate = 22050
    mono = sine_tone(220.0, 3.0, sample_rate) * 0.3
    stereo = np.stack([mono, mono], axis=1)  # shape (n_frames, 2)
    assert stereo.shape == (len(mono), 2)

    waveform = generate_waveform(stereo, sample_rate)
    assert waveform.duration_sec == pytest.approx(3.0, abs=0.01)
    assert len(waveform.peaks) > 10


def test_key_estimate_returns_a_well_formed_result():
    sample_rate = 22050
    # A simple C major triad (C4, E4, G4) sustained.
    audio = (
        sine_tone(261.63, 2.0, sample_rate) + sine_tone(329.63, 2.0, sample_rate) + sine_tone(392.0, 2.0, sample_rate)
    )
    result = estimate_key(audio / 3, sample_rate)
    assert result.mode in ("major", "minor")
    assert 0.0 <= result.confidence <= 1.0
    assert result.tonic in ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
