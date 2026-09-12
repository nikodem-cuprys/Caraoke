"""SEGMENT_LYRICS stage: group a flat, word-level transcription into lyric
lines. Pure function of (word list) -> (line list) so it is directly unit
testable without any model in the loop.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from itertools import pairwise

from .transcribe import TranscribedWord

SENTENCE_END_CHARS = (".", "!", "?")


@dataclass
class LyricLineSegment:
    start: float
    end: float
    words: list[TranscribedWord] = field(default_factory=list)


def segment_words_into_lines(
    words: list[TranscribedWord],
    gap_threshold_sec: float = 0.6,
    max_words_per_line: int = 10,
) -> list[LyricLineSegment]:
    """Breaks a line whenever: the pause before the next word exceeds
    gap_threshold_sec, the current word ends a sentence, or the line has
    grown to max_words_per_line — whichever comes first. This is a simple,
    predictable heuristic; if a `LyricsProvider` supplies externally
    licensed, pre-segmented lyrics in the future it can bypass this stage
    entirely.
    """
    if not words:
        return []

    lines: list[LyricLineSegment] = []
    current = LyricLineSegment(start=words[0].start, end=words[0].end, words=[words[0]])

    for prev, word in pairwise(words):
        gap = word.start - prev.end
        should_break = (
            gap > gap_threshold_sec
            or len(current.words) >= max_words_per_line
            or prev.text.strip().endswith(SENTENCE_END_CHARS)
        )
        if should_break:
            lines.append(current)
            current = LyricLineSegment(start=word.start, end=word.end, words=[word])
        else:
            current.words.append(word)
            current.end = word.end

    lines.append(current)
    return lines
