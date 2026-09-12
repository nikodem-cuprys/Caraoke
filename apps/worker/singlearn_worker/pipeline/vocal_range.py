"""Computes an approximate vocal range from the simplified melody notes.
Uses the notes (not raw frames) so a single spurious high/low frame that
survived smoothing but never became a real note can't skew the range."""

from __future__ import annotations

from dataclasses import dataclass

from ..music_theory import midi_to_note_name
from .simplify_melody import MelodyNote


@dataclass
class VocalRange:
    lowest_midi: int
    highest_midi: int
    lowest_note: str
    highest_note: str
    semitone_range: int
    sample_count: int


def compute_vocal_range(notes: list[MelodyNote]) -> VocalRange | None:
    if not notes:
        return None
    lowest = min(n.midi for n in notes)
    highest = max(n.midi for n in notes)
    return VocalRange(
        lowest_midi=lowest,
        highest_midi=highest,
        lowest_note=midi_to_note_name(lowest),
        highest_note=midi_to_note_name(highest),
        semitone_range=highest - lowest,
        sample_count=len(notes),
    )
