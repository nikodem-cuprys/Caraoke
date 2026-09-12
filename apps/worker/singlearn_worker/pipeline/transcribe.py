"""TRANSCRIBE + ALIGN_WORDS stages.

Uses faster-whisper (MIT licensed, CTranslate2-based reimplementation of
OpenAI Whisper) with `word_timestamps=True`, which gives per-word start/end
times derived from cross-attention alignment plus a probability we surface
as the word's confidence. This is the MVP alignment strategy described in
the architecture doc; a forced-alignment pass (e.g. a wav2vec2 CTC aligner,
as WhisperX uses) is a natural upgrade if word timing precision needs to
improve, and can be dropped in behind the same TranscriptionProvider
interface without touching the rest of the pipeline.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class TranscribedWord:
    text: str
    start: float
    end: float
    confidence: float


@dataclass
class TranscriptionResult:
    words: list[TranscribedWord]
    language: str
    language_confidence: float


class TranscriptionProvider:
    def transcribe(self, audio_path: str, language_override: str | None = None) -> TranscriptionResult:
        raise NotImplementedError


class FasterWhisperTranscriptionProvider(TranscriptionProvider):
    def __init__(self, model_size: str = "base", device: str = "cpu", compute_type: str | None = None):
        from faster_whisper import WhisperModel

        self.model = WhisperModel(
            model_size, device=device, compute_type=compute_type or ("int8" if device == "cpu" else "float16")
        )

    def transcribe(self, audio_path: str, language_override: str | None = None) -> TranscriptionResult:
        segments, info = self.model.transcribe(
            audio_path,
            word_timestamps=True,
            language=language_override,
            vad_filter=True,
        )
        words: list[TranscribedWord] = []
        for segment in segments:
            for word in segment.words or []:
                text = word.word.strip()
                if not text:
                    continue
                words.append(
                    TranscribedWord(
                        text=text,
                        start=float(word.start),
                        end=float(word.end),
                        confidence=float(word.probability),
                    )
                )
        return TranscriptionResult(
            words=words,
            language=info.language,
            language_confidence=float(info.language_probability),
        )
