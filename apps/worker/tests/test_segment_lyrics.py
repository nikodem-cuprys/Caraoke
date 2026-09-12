from singlearn_worker.pipeline.segment_lyrics import segment_words_into_lines
from singlearn_worker.pipeline.transcribe import TranscribedWord


def w(text, start, end, confidence=0.9):
    return TranscribedWord(text=text, start=start, end=end, confidence=confidence)


def test_empty_input():
    assert segment_words_into_lines([]) == []


def test_breaks_on_long_pause():
    words = [w("hello", 0, 0.5), w("world", 0.6, 1.0), w("second", 3.0, 3.4), w("line", 3.5, 3.9)]
    lines = segment_words_into_lines(words, gap_threshold_sec=0.6)
    assert len(lines) == 2
    assert [word.text for word in lines[0].words] == ["hello", "world"]
    assert [word.text for word in lines[1].words] == ["second", "line"]
    assert lines[0].start == 0
    assert lines[0].end == 1.0


def test_breaks_on_sentence_end_punctuation():
    words = [w("stop.", 0, 0.5), w("go", 0.7, 1.0)]
    lines = segment_words_into_lines(words, gap_threshold_sec=5.0)
    assert len(lines) == 2


def test_breaks_on_max_words_per_line():
    words = [w(str(i), i, i + 0.3) for i in range(25)]
    lines = segment_words_into_lines(words, gap_threshold_sec=5.0, max_words_per_line=10)
    assert all(len(line.words) <= 10 for line in lines)
    assert sum(len(line.words) for line in lines) == 25


def test_no_spurious_break_for_normal_singing_pace():
    words = [w(str(i), i * 0.3, i * 0.3 + 0.25) for i in range(8)]
    lines = segment_words_into_lines(words, gap_threshold_sec=0.6, max_words_per_line=10)
    assert len(lines) == 1
