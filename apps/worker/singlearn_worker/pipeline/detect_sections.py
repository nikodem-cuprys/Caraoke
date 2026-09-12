"""SEGMENT_LYRICS-adjacent stage: conservative, heuristic song-section
detection (intro/verse/pre_chorus/chorus/bridge/outro/instrumental).

There is no reliable audio-only section classifier in this MVP's dependency
budget, so sections are inferred from two weak-but-useful signals: (1) pause
length between lyric lines (a block of closely-spaced lines separated from
its neighbors by a longer pause is probably one section) and (2) lyrical
repetition (a block whose words closely match an earlier block is probably
a chorus repeating). Every section this produces is marked `is_estimated =
True` with a modest confidence, and the API lets users edit/relabel them —
this function does not pretend to be a music-structure classifier.
"""

from __future__ import annotations

from dataclasses import dataclass
from itertools import pairwise

from .segment_lyrics import LyricLineSegment

BLOCK_GAP_THRESHOLD_SEC = 3.0
INSTRUMENTAL_GAP_THRESHOLD_SEC = 8.0
MIN_EDGE_SECTION_SEC = 3.0
CHORUS_SIMILARITY_THRESHOLD = 0.6


@dataclass
class Section:
    type: str
    label: str
    start: float
    end: float
    confidence: float
    is_estimated: bool = True


@dataclass
class _Block:
    lines: list[LyricLineSegment]

    @property
    def start(self) -> float:
        return self.lines[0].start

    @property
    def end(self) -> float:
        return self.lines[-1].end

    def word_set(self) -> set[str]:
        return {w.text.strip(".,!?").lower() for line in self.lines for w in line.words if w.text.strip(".,!?")}


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def _group_into_blocks(lines: list[LyricLineSegment]) -> list[_Block]:
    if not lines:
        return []
    blocks = [_Block(lines=[lines[0]])]
    for prev, line in pairwise(lines):
        gap = line.start - prev.end
        if gap > BLOCK_GAP_THRESHOLD_SEC:
            blocks.append(_Block(lines=[line]))
        else:
            blocks[-1].lines.append(line)
    return blocks


def _cluster_similar_blocks(blocks: list[_Block]) -> list[int]:
    """Union-find clustering of blocks whose lyrics substantially overlap."""
    parent = list(range(len(blocks)))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(x: int, y: int) -> None:
        parent[find(x)] = find(y)

    word_sets = [b.word_set() for b in blocks]
    for i in range(len(blocks)):
        for j in range(i + 1, len(blocks)):
            if _jaccard(word_sets[i], word_sets[j]) >= CHORUS_SIMILARITY_THRESHOLD:
                union(i, j)

    return [find(i) for i in range(len(blocks))]


def detect_sections(lines: list[LyricLineSegment], song_duration_sec: float) -> list[Section]:
    sections: list[Section] = []
    blocks = _group_into_blocks(lines)
    if not blocks:
        return sections

    if blocks[0].start >= MIN_EDGE_SECTION_SEC:
        sections.append(Section(type="intro", label="Intro", start=0, end=blocks[0].start, confidence=0.5))

    cluster_ids = _cluster_similar_blocks(blocks)
    cluster_counts: dict[int, int] = {}
    for cid in cluster_ids:
        cluster_counts[cid] = cluster_counts.get(cid, 0) + 1
    chorus_cluster = max(cluster_counts, key=lambda c: cluster_counts[c]) if cluster_counts else None
    chorus_is_real = chorus_cluster is not None and cluster_counts[chorus_cluster] >= 2

    # Pre-chorus detection was deliberately dropped: distinguishing a short
    # transitional pre-chorus from an ordinary short verse using only lyrics
    # and pause timing proved unreliable (a real verse can be just as short
    # as a pre-chorus). Rather than guess and risk a confidently wrong
    # label, such blocks are left as "verse" — the type stays available for
    # the user to relabel via the section-editing API.
    #
    # Bridge detection only fires after the *second* chorus occurrence,
    # matching the common verse-chorus-verse-chorus-bridge-chorus structure;
    # a non-chorus block between the first and second chorus is almost
    # always just the next verse, not a bridge.
    verse_number = 0
    chorus_seen = 0
    for idx, block in enumerate(blocks):
        is_chorus = chorus_is_real and cluster_ids[idx] == chorus_cluster
        if is_chorus:
            chorus_seen += 1
            sections.append(Section(type="chorus", label="Chorus", start=block.start, end=block.end, confidence=0.65))
        elif chorus_seen >= 2:
            sections.append(Section(type="bridge", label="Bridge", start=block.start, end=block.end, confidence=0.35))
        else:
            verse_number += 1
            sections.append(
                Section(type="verse", label=f"Verse {verse_number}", start=block.start, end=block.end, confidence=0.5)
            )

        if idx + 1 < len(blocks):
            gap_start, gap_end = block.end, blocks[idx + 1].start
            if gap_end - gap_start >= INSTRUMENTAL_GAP_THRESHOLD_SEC:
                sections.append(
                    Section(type="instrumental", label="Instrumental", start=gap_start, end=gap_end, confidence=0.4)
                )

    if song_duration_sec - blocks[-1].end >= MIN_EDGE_SECTION_SEC:
        sections.append(
            Section(type="outro", label="Outro", start=blocks[-1].end, end=song_duration_sec, confidence=0.5)
        )

    sections.sort(key=lambda s: s.start)
    return sections
