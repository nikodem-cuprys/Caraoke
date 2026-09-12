"""Pure music-theory helpers. Mirrors packages/shared/src/music.ts so the
worker and the TypeScript app agree on the same conversions; kept as a
separate small module (rather than importing across languages) and covered
by its own unit tests to guarantee that agreement.
"""

from __future__ import annotations

import math

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def hz_to_midi(frequency_hz: float) -> float:
    if not frequency_hz > 0:
        raise ValueError(f"hz_to_midi requires a positive frequency, got {frequency_hz}")
    return 69 + 12 * math.log2(frequency_hz / 440)


def midi_to_hz(midi: float) -> float:
    return 440 * (2 ** ((midi - 69) / 12))


def midi_to_note_name(midi: float) -> str:
    rounded = round(midi)
    note_index = rounded % 12
    octave = rounded // 12 - 1
    return f"{NOTE_NAMES[note_index]}{octave}"


def note_name_to_midi(note_name: str) -> int:
    import re

    match = re.match(r"^([A-Ga-g])([#b]?)(-?\d+)$", note_name.strip())
    if not match:
        raise ValueError(f"Invalid note name: {note_name}")
    letter, accidental, octave_str = match.groups()
    base_index = next(i for i, n in enumerate(NOTE_NAMES) if n[0] == letter.upper())
    semitone = base_index
    if accidental == "#":
        semitone += 1
    elif accidental == "b":
        semitone -= 1
    octave = int(octave_str)
    return (octave + 1) * 12 + semitone


def cents_off_from_midi(frequency_hz: float, target_midi: float) -> float:
    return (hz_to_midi(frequency_hz) - target_midi) * 100
