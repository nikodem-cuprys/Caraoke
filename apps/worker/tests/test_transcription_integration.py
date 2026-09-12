"""Runs the real faster-whisper transcription + lyric-line segmentation on
the checked-in synthetic fixture (fixtures/synthetic_song.wav: a TTS-spoken
lyric line over a synthesized backing chord -- see fixtures/generate_fixture.py).
No network access is required beyond the one-time model download that
faster-whisper caches under ~/.cache/huggingface on first run.
"""

import json
import os
from itertools import pairwise

import pytest

from singlearn_worker.pipeline.segment_lyrics import segment_words_into_lines
from singlearn_worker.pipeline.transcribe import FasterWhisperTranscriptionProvider

FIXTURE_DIR = os.path.join(os.path.dirname(__file__), "..", "fixtures")
FIXTURE_WAV = os.path.join(FIXTURE_DIR, "synthetic_song.wav")
FIXTURE_JSON = os.path.join(FIXTURE_DIR, "synthetic_song.json")

pytestmark = pytest.mark.skipif(
    not os.path.exists(FIXTURE_WAV), reason="fixture not generated; run fixtures/generate_fixture.py"
)


@pytest.fixture(scope="module")
def transcription():
    provider = FasterWhisperTranscriptionProvider(model_size="base", device="cpu")
    return provider.transcribe(FIXTURE_WAV, language_override="en")


def test_detects_correct_language():
    provider = FasterWhisperTranscriptionProvider(model_size="base", device="cpu")
    result = provider.transcribe(FIXTURE_WAV)
    assert result.language == "en"
    assert result.language_confidence > 0.8


def test_recovers_expected_words_with_real_timestamps(transcription):
    with open(FIXTURE_JSON, encoding="utf-8") as fh:
        expected = json.load(fh)["expectedWords"]

    recognized = [w.text.strip(".,!?").lower() for w in transcription.words]
    assert recognized == [w.lower() for w in expected]

    # Words must have monotonically increasing, non-overlapping timestamps.
    for prev, cur in pairwise(transcription.words):
        assert cur.start >= prev.start
        assert prev.end <= cur.start + 1e-6

    assert all(0.0 <= w.confidence <= 1.0 for w in transcription.words)
    assert transcription.words[0].start < 0.5
    assert transcription.words[-1].end < 5.0


def test_words_segment_into_a_single_line(transcription):
    lines = segment_words_into_lines(transcription.words)
    assert len(lines) == 1
    assert lines[0].start == transcription.words[0].start
    assert lines[0].end == transcription.words[-1].end
