"""Estimates potentially difficult passages from the simplified melody:
large interval jumps, the single highest/lowest note, long sustained notes,
and bursts of rapid melodic change. These are explicitly presented to the
user as estimates, never certainties (see severity, 0..1, and the DTO's
`detail` string)."""

from __future__ import annotations

from dataclasses import dataclass
from itertools import pairwise

from .simplify_melody import MelodyNote

LARGE_INTERVAL_SEMITONES = 7  # a perfect fifth or more
LONG_SUSTAIN_SEC = 2.0
RAPID_CHANGE_WINDOW_SEC = 1.5
RAPID_CHANGE_MIN_NOTES = 4


@dataclass
class DifficultPart:
    start: float
    end: float
    reason: str
    detail: str
    severity: float


def find_difficult_parts(notes: list[MelodyNote]) -> list[DifficultPart]:
    if not notes:
        return []

    parts: list[DifficultPart] = []

    for prev, cur in pairwise(notes):
        interval = abs(cur.midi - prev.midi)
        if interval >= LARGE_INTERVAL_SEMITONES:
            severity = min(1.0, interval / 12)
            parts.append(
                DifficultPart(
                    start=prev.start,
                    end=cur.end,
                    reason="large_interval_jump",
                    detail=f"Large melodic jump of about {interval} semitones (estimate)",
                    severity=severity,
                )
            )

    highest = max(notes, key=lambda n: n.midi)
    lowest = min(notes, key=lambda n: n.midi)
    if highest.midi != lowest.midi:
        parts.append(
            DifficultPart(
                start=highest.start,
                end=highest.end,
                reason="highest_note",
                detail=f"The highest target note in this song ({highest.note_name}, estimate)",
                severity=0.8,
            )
        )
        parts.append(
            DifficultPart(
                start=lowest.start,
                end=lowest.end,
                reason="lowest_note",
                detail=f"The lowest target note in this song ({lowest.note_name}, estimate)",
                severity=0.5,
            )
        )

    for note in notes:
        duration = note.end - note.start
        if duration >= LONG_SUSTAIN_SEC:
            parts.append(
                DifficultPart(
                    start=note.start,
                    end=note.end,
                    reason="long_sustain",
                    detail=f"Sustained note held for about {duration:.1f}s (estimate)",
                    severity=min(1.0, duration / 4),
                )
            )

    i = 0
    while i < len(notes):
        window_end_time = notes[i].start + RAPID_CHANGE_WINDOW_SEC
        window_notes = [n for n in notes[i:] if n.start < window_end_time]
        if len(window_notes) >= RAPID_CHANGE_MIN_NOTES:
            parts.append(
                DifficultPart(
                    start=window_notes[0].start,
                    end=window_notes[-1].end,
                    reason="rapid_melodic_change",
                    detail=f"{len(window_notes)} note changes in under {RAPID_CHANGE_WINDOW_SEC}s (estimate)",
                    severity=min(1.0, len(window_notes) / 8),
                )
            )
            i += len(window_notes)
        else:
            i += 1

    parts.sort(key=lambda p: p.start)
    return parts
