import pytest

from singlearn_worker.music_theory import (
    cents_off_from_midi,
    hz_to_midi,
    midi_to_hz,
    midi_to_note_name,
    note_name_to_midi,
)


def test_hz_to_midi_a4():
    assert hz_to_midi(440) == pytest.approx(69, abs=1e-6)


def test_hz_to_midi_a3():
    assert hz_to_midi(220) == pytest.approx(57, abs=1e-6)


def test_hz_to_midi_c5():
    assert hz_to_midi(523.2511) == pytest.approx(72, abs=1e-2)


def test_hz_to_midi_rejects_non_positive():
    with pytest.raises(ValueError):
        hz_to_midi(0)
    with pytest.raises(ValueError):
        hz_to_midi(-5)


def test_midi_to_hz_is_inverse_of_hz_to_midi():
    for hz in [110, 261.63, 440, 880]:
        assert midi_to_hz(hz_to_midi(hz)) == pytest.approx(hz, rel=1e-6)


@pytest.mark.parametrize(
    "midi,expected",
    [(69, "A4"), (60, "C4"), (61, "C#4"), (72, "C5"), (57, "A3"), (0, "C-1")],
)
def test_midi_to_note_name(midi, expected):
    assert midi_to_note_name(midi) == expected


def test_midi_to_note_name_rounds():
    assert midi_to_note_name(69.4) == "A4"
    assert midi_to_note_name(69.6) == "A#4"


def test_note_name_round_trip():
    for midi in [40, 45, 57, 60, 61, 69, 72, 84]:
        assert note_name_to_midi(midi_to_note_name(midi)) == midi


def test_note_name_flats():
    assert note_name_to_midi("Bb3") == note_name_to_midi("A#3")


def test_note_name_invalid():
    with pytest.raises(ValueError):
        note_name_to_midi("nope")


def test_cents_off_from_midi_zero_on_pitch():
    assert cents_off_from_midi(440, 69) == pytest.approx(0, abs=1e-3)


def test_cents_off_from_midi_sharp_and_flat():
    assert cents_off_from_midi(midi_to_hz(70), 69) == pytest.approx(100, abs=1e-3)
    assert cents_off_from_midi(midi_to_hz(68), 69) == pytest.approx(-100, abs=1e-3)
