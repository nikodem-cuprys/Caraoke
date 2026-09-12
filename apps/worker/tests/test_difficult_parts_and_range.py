from singlearn_worker.pipeline.difficult_parts import find_difficult_parts
from singlearn_worker.pipeline.simplify_melody import MelodyNote
from singlearn_worker.pipeline.vocal_range import compute_vocal_range


def note(start, end, midi):
    return MelodyNote(start=start, end=end, midi=midi, note_name=f"m{midi}", confidence=0.8, mean_frequency_hz=440)


def test_vocal_range_empty():
    assert compute_vocal_range([]) is None


def test_vocal_range_basic():
    notes = [note(0, 1, 60), note(1, 2, 72), note(2, 3, 65)]
    r = compute_vocal_range(notes)
    assert r.lowest_midi == 60
    assert r.highest_midi == 72
    assert r.semitone_range == 12
    assert r.sample_count == 3


def test_difficult_parts_empty():
    assert find_difficult_parts([]) == []


def test_large_interval_jump_detected():
    notes = [note(0, 0.5, 60), note(0.5, 1.0, 69)]  # 9 semitone jump
    parts = find_difficult_parts(notes)
    assert any(p.reason == "large_interval_jump" for p in parts)


def test_small_interval_not_flagged_as_jump():
    notes = [note(0, 0.5, 60), note(0.5, 1.0, 62)]  # whole tone
    parts = find_difficult_parts(notes)
    assert not any(p.reason == "large_interval_jump" for p in parts)


def test_long_sustain_detected():
    notes = [note(0, 3.0, 60)]
    parts = find_difficult_parts(notes)
    assert any(p.reason == "long_sustain" for p in parts)


def test_highest_and_lowest_flagged_when_range_exists():
    notes = [note(0, 0.5, 60), note(0.5, 1.0, 72), note(1.0, 1.5, 65)]
    parts = find_difficult_parts(notes)
    reasons = {p.reason for p in parts}
    assert "highest_note" in reasons
    assert "lowest_note" in reasons


def test_severity_is_bounded_0_to_1():
    notes = [note(0, 0.5, 40), note(0.5, 1.0, 90)]  # extreme jump
    parts = find_difficult_parts(notes)
    assert all(0.0 <= p.severity <= 1.0 for p in parts)
