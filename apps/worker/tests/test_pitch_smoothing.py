import pytest

from singlearn_worker.pipeline.detect_pitch import PitchFrame, smooth_pitch_contour


def make_frames(freqs, confidence=0.9, hop=0.01):
    frames = []
    for i, f in enumerate(freqs):
        voiced = f is not None
        frames.append(PitchFrame(t=i * hop, frequency_hz=f, confidence=confidence if voiced else 0.0, voiced=voiced))
    return frames


def test_removes_single_frame_octave_jump():
    # A steady 220Hz contour with one spurious octave-doubled outlier.
    freqs = [220.0] * 4 + [440.0] + [220.0] * 4
    frames = make_frames(freqs)
    smoothed = smooth_pitch_contour(frames, median_window=5)
    assert smoothed[4].frequency_hz == 220.0


def test_preserves_slow_vibrato_shape():
    import math

    # ~6Hz vibrato around 440Hz sampled at 100Hz (hop=0.01s) -> ~16-17 frames/cycle.
    freqs = [440.0 + 10 * math.sin(2 * math.pi * 6 * i * 0.01) for i in range(60)]
    frames = make_frames(freqs)
    smoothed = smooth_pitch_contour(frames, median_window=5)

    # The smoothed contour should still oscillate (not be flattened to a constant).
    smoothed_values = [f.frequency_hz for f in smoothed]
    assert max(smoothed_values) - min(smoothed_values) > 10


def test_never_invents_pitch_for_unvoiced_frames():
    frames = make_frames([220.0, 220.0, None, None, 220.0])
    smoothed = smooth_pitch_contour(frames)
    assert smoothed[2].frequency_hz is None
    assert smoothed[2].voiced is False


def test_rejects_even_window():
    frames = make_frames([220.0])
    with pytest.raises(ValueError):
        smooth_pitch_contour(frames, median_window=4)
