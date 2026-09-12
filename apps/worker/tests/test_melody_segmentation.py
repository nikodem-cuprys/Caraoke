from singlearn_worker.music_theory import midi_to_hz
from singlearn_worker.pipeline.detect_pitch import PitchFrame
from singlearn_worker.pipeline.simplify_melody import simplify_melody


def frame(t, midi, confidence=0.9, voiced=True):
    freq = midi_to_hz(midi) if voiced else None
    return PitchFrame(t=t, frequency_hz=freq, confidence=confidence, voiced=voiced)


def test_single_steady_run_produces_one_note():
    frames = [frame(i * 0.05, 69) for i in range(10)]  # 0.5s of A4
    notes = simplify_melody(frames, min_note_duration_sec=0.08)
    assert len(notes) == 1
    assert notes[0].midi == 69
    assert notes[0].note_name == "A4"


def test_two_distinct_pitches_produce_two_notes():
    frames = [frame(i * 0.05, 69) for i in range(6)] + [frame((6 + i) * 0.05, 72) for i in range(6)]
    notes = simplify_melody(frames, min_note_duration_sec=0.08)
    assert [n.midi for n in notes] == [69, 72]
    assert notes[0].end <= notes[1].start + 1e-6


def test_low_confidence_run_produces_no_note():
    frames = [frame(i * 0.05, 69, confidence=0.2) for i in range(10)]
    notes = simplify_melody(frames, confidence_threshold=0.5)
    assert notes == []


def test_unvoiced_gap_produces_no_note():
    frames = [frame(i * 0.05, 69, voiced=False) for i in range(10)]
    notes = simplify_melody(frames)
    assert notes == []


def test_transient_blip_shorter_than_min_duration_is_dropped():
    # A single 20ms blip at a different pitch in the middle of a steady note
    # should not appear as its own note (and shouldn't corrupt the
    # surrounding note either -- it just splits it into two eligible runs).
    frames = (
        [frame(i * 0.01, 69) for i in range(20)]
        + [frame((20) * 0.01, 76)]  # one 10ms frame at a different pitch
        + [frame((21 + i) * 0.01, 69) for i in range(20)]
    )
    notes = simplify_melody(frames, min_note_duration_sec=0.08)
    assert all(n.midi != 76 for n in notes)


def test_mean_frequency_reflects_raw_values_not_quantized_target():
    # Frames hover slightly around A4 (69) but never land on exactly 440Hz.
    frames = [frame(i * 0.05, 69 + 0.05, confidence=0.9) for i in range(10)]
    notes = simplify_melody(frames, min_note_duration_sec=0.08)
    assert len(notes) == 1
    assert notes[0].midi == 69
    assert notes[0].mean_frequency_hz > midi_to_hz(69)
