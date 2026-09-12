"""SIMPLIFY_MELODY stage: turn the raw, frame-by-frame pitch contour (one
point roughly every ~12ms) into a small number of discrete sung-note
targets (e.g. "G4 -> A4 -> C5 -> B4") suitable for driving the pitch
visualization's target-note display and the Learn Melody mode's note names.

Deliberately conservative: a note is only ever emitted for a run of frames
that are BOTH voiced and above the confidence threshold for at least
min_note_duration_sec. Low-confidence or unvoiced spans (consonants,
breaths, spoken/rap passages, silence) simply produce no note rather than a
fabricated one. A short transient blip that doesn't clear
min_note_duration_sec is dropped rather than reported as a real note.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..music_theory import hz_to_midi, midi_to_note_name
from .detect_pitch import PitchFrame

DEFAULT_CONFIDENCE_THRESHOLD = 0.5
DEFAULT_MIN_NOTE_DURATION_SEC = 0.08


@dataclass
class MelodyNote:
    start: float
    end: float
    midi: int
    note_name: str
    confidence: float
    mean_frequency_hz: float


def _frame_duration(frames: list[PitchFrame], index: int) -> float:
    if index + 1 < len(frames):
        return frames[index + 1].t - frames[index].t
    if index > 0:
        return frames[index].t - frames[index - 1].t
    return 0.01


def simplify_melody(
    frames: list[PitchFrame],
    confidence_threshold: float = DEFAULT_CONFIDENCE_THRESHOLD,
    min_note_duration_sec: float = DEFAULT_MIN_NOTE_DURATION_SEC,
) -> list[MelodyNote]:
    eligible = [f.voiced and f.frequency_hz is not None and f.confidence >= confidence_threshold for f in frames]

    notes: list[MelodyNote] = []
    i = 0
    n = len(frames)
    while i < n:
        if not eligible[i]:
            i += 1
            continue

        # Extend the current run while pitch stays on (or returns to) the
        # same rounded semitone and frames remain eligible.
        current_midi = round(hz_to_midi(frames[i].frequency_hz))  # type: ignore[arg-type]
        run_start = i
        j = i
        while j < n and eligible[j] and round(hz_to_midi(frames[j].frequency_hz)) == current_midi:  # type: ignore[arg-type]
            j += 1
        run_end = j - 1

        start_t = frames[run_start].t
        end_t = frames[run_end].t + _frame_duration(frames, run_end)
        duration = end_t - start_t

        if duration >= min_note_duration_sec:
            run_frames = frames[run_start : run_end + 1]
            mean_freq = sum(f.frequency_hz for f in run_frames) / len(run_frames)  # type: ignore[misc]
            mean_conf = sum(f.confidence for f in run_frames) / len(run_frames)
            notes.append(
                MelodyNote(
                    start=start_t,
                    end=end_t,
                    midi=current_midi,
                    note_name=midi_to_note_name(current_midi),
                    confidence=mean_conf,
                    mean_frequency_hz=mean_freq,
                )
            )
        # else: transient blip shorter than the minimum note duration — dropped.

        i = j

    return notes
