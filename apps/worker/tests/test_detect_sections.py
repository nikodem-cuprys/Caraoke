from singlearn_worker.pipeline.detect_sections import detect_sections
from singlearn_worker.pipeline.segment_lyrics import LyricLineSegment
from singlearn_worker.pipeline.transcribe import TranscribedWord


def line(start, end, text, words_gap=0.3):
    words = []
    t = start
    for token in text.split():
        words.append(TranscribedWord(text=token, start=t, end=min(t + words_gap, end), confidence=0.9))
        t += words_gap
    return LyricLineSegment(start=start, end=end, words=words)


def test_no_lines_returns_no_sections():
    assert detect_sections([], 100.0) == []


def test_detects_intro_when_first_line_starts_late():
    lines = [line(10, 12, "hello there my friend")]
    sections = detect_sections(lines, song_duration_sec=20)
    intro = [s for s in sections if s.type == "intro"]
    assert len(intro) == 1
    assert intro[0].start == 0
    assert intro[0].end == 10


def test_detects_outro_when_song_continues_after_last_line():
    lines = [line(0, 2, "hello there my friend")]
    sections = detect_sections(lines, song_duration_sec=15)
    outro = [s for s in sections if s.type == "outro"]
    assert len(outro) == 1
    assert outro[0].end == 15


def test_repeated_block_detected_as_chorus():
    chorus_text = "we will rock you all night long"
    lines = [
        line(0, 3, "some unique verse words here today"),
        line(10, 13, chorus_text),
        line(20, 23, "another unique verse about the sky"),
        line(30, 33, chorus_text),
    ]
    sections = detect_sections(lines, song_duration_sec=40)
    chorus_sections = [s for s in sections if s.type == "chorus"]
    assert len(chorus_sections) == 2

    verse_sections = [s for s in sections if s.type == "verse"]
    assert len(verse_sections) == 2
    assert verse_sections[0].label == "Verse 1"
    assert verse_sections[1].label == "Verse 2"


def test_all_sections_marked_as_estimated():
    lines = [line(0, 2, "one line only here")]
    sections = detect_sections(lines, song_duration_sec=2)
    assert all(s.is_estimated for s in sections)
