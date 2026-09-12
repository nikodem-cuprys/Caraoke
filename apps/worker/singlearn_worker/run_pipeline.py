"""Orchestrates one processing job end-to-end: PREPARE_AUDIO -> SEPARATE_STEMS
-> TRANSCRIBE -> ALIGN_WORDS -> DETECT_PITCH -> SIMPLIFY_MELODY ->
SEGMENT_LYRICS -> GENERATE_WAVEFORM -> BUILD_KARAOKE -> COMPLETE.

Each stage reports running/done/failed to the API via ApiClient so the
frontend's processing screen reflects real pipeline state over SSE, not a
simulated progress bar.
"""

from __future__ import annotations

import json
import os
import traceback

import requests
import soundfile as sf

from .api_client import ApiClient
from .config import config
from .music_theory import midi_to_hz  # noqa: F401  (re-exported for convenience/tests)
from .pipeline.detect_pitch import estimate_pitch_contour, smooth_pitch_contour
from .pipeline.detect_sections import detect_sections
from .pipeline.difficult_parts import find_difficult_parts
from .pipeline.key_estimate import estimate_key
from .pipeline.prepare_audio import prepare_audio
from .pipeline.segment_lyrics import segment_words_into_lines
from .pipeline.separate_stems import get_separation_provider
from .pipeline.simplify_melody import simplify_melody
from .pipeline.transcribe import FasterWhisperTranscriptionProvider
from .pipeline.vocal_range import compute_vocal_range
from .pipeline.waveform import generate_waveform


class PipelineError(RuntimeError):
    def __init__(self, stage: str, message: str):
        super().__init__(f"[{stage}] {message}")
        self.stage = stage


# Maps the browser-reported upload MIME type to a file extension so the
# downloaded temp file gives ffmpeg's demuxer a hint (content-based probing
# alone is usually enough, but a correct extension is more reliable for
# container formats like mp4/webm that can hold either audio or video).
_EXTENSION_BY_MIME_TYPE = {
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/x-m4a": ".m4a",
    "audio/ogg": ".ogg",
    "audio/flac": ".flac",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
}


def _download_source_audio(job: dict, job_work_dir: str) -> str:
    """Downloads the original upload from its presigned URL into a local
    temp file, mirroring what a shared filesystem gives PREPARE_AUDIO for
    free when STORAGE_PROVIDER=local. Used only when the worker and API
    don't share a filesystem (e.g. STORAGE_PROVIDER=s3)."""
    signed_url = job.get("sourceAudioSignedUrl")
    if not signed_url:
        raise PipelineError(
            "PREPARE_AUDIO", "Job has neither sourceAudioLocalPath nor sourceAudioSignedUrl - nothing to process."
        )
    extension = _EXTENSION_BY_MIME_TYPE.get(job.get("sourceAudioMimeType", ""), "")
    dest_path = os.path.join(job_work_dir, f"source_original{extension}")
    response = requests.get(signed_url, stream=True, timeout=120)
    response.raise_for_status()
    with open(dest_path, "wb") as fh:
        for chunk in response.iter_content(chunk_size=1024 * 1024):
            fh.write(chunk)
    return dest_path


def run_job(job: dict, api: ApiClient) -> None:
    job_id = job["jobId"]
    os.makedirs(config.work_dir, exist_ok=True)
    job_work_dir = os.path.join(config.work_dir, job_id)
    os.makedirs(job_work_dir, exist_ok=True)

    storage_root = job.get("storageLocalRoot")
    storage_prefix = job["storageKeyPrefix"]
    # Local mode: the API and worker share a filesystem, so every stage
    # writes straight into the shared storage root and nothing needs
    # uploading. Remote mode (e.g. S3): there is no shared filesystem, so
    # the source audio is downloaded up front and every produced asset is
    # written to a local temp dir first, then uploaded via a presigned URL
    # (see finalize_asset below).
    remote_storage = not storage_root

    def stage(name: str, detail: str | None = None):
        api.update_stage(job_id, name, "running", detail=detail)

    def done(name: str, detail: str | None = None):
        api.update_stage(job_id, name, "done", detail=detail)

    def asset_key(filename: str) -> str:
        return f"{storage_prefix}{filename}"

    def finalize_asset(local_path: str, filename: str, content_type: str) -> None:
        """Uploads a just-written local file to object storage in remote
        mode; a no-op in local mode, where song_output_dir already IS the
        shared storage root the API serves from."""
        if not remote_storage:
            return
        upload_url = api.get_upload_url(job_id, asset_key(filename), content_type)
        with open(local_path, "rb") as fh:
            response = requests.put(upload_url, data=fh, headers={"Content-Type": content_type}, timeout=120)
        response.raise_for_status()

    try:
        if remote_storage:
            song_output_dir = job_work_dir
            source_audio_path = _download_source_audio(job, job_work_dir)
        else:
            song_output_dir = os.path.join(storage_root, storage_prefix)
            os.makedirs(song_output_dir, exist_ok=True)
            source_audio_path = job["sourceAudioLocalPath"]

        # ---- PREPARE_AUDIO ----
        stage("PREPARE_AUDIO", "Normalizing audio to a consistent sample rate/format")
        prepared_path = os.path.join(song_output_dir, "prepared_reference.wav")
        prepared = prepare_audio(source_audio_path, prepared_path)
        api.register_asset(
            job_id, "prepared_reference", asset_key("prepared_reference.wav"), "audio/wav", prepared.duration_sec
        )
        finalize_asset(prepared_path, "prepared_reference.wav", "audio/wav")
        done("PREPARE_AUDIO", f"{prepared.duration_sec:.1f}s reference track prepared")

        # ---- SEPARATE_STEMS ----
        stage("SEPARATE_STEMS", f"Running {config.separation_engine} source separation")
        separator = get_separation_provider(config.separation_engine)
        separation = separator.separate(prepared.path, job_work_dir)
        if separation.available:
            vocals_path = os.path.join(song_output_dir, "vocals.wav")
            instrumental_path = os.path.join(song_output_dir, "instrumental.wav")
            _copy_into_storage(separation.vocals_path, vocals_path)
            _copy_into_storage(separation.instrumental_path, instrumental_path)
            api.register_asset(job_id, "vocals", asset_key("vocals.wav"), "audio/wav", provider_name=separation.engine)
            api.register_asset(
                job_id, "instrumental", asset_key("instrumental.wav"), "audio/wav", provider_name=separation.engine
            )
            finalize_asset(vocals_path, "vocals.wav", "audio/wav")
            finalize_asset(instrumental_path, "instrumental.wav", "audio/wav")
            done("SEPARATE_STEMS", f"Separated with {separation.engine}")
            vocals_path_for_analysis = vocals_path
        else:
            done("SEPARATE_STEMS", "Separation unavailable in this deployment; analyzing the mixed track instead")
            vocals_path_for_analysis = separation.vocals_path

        # ---- TRANSCRIBE + ALIGN_WORDS ----
        stage("TRANSCRIBE", f"Transcribing vocals with faster-whisper ({config.whisper_model_size})")
        transcriber = FasterWhisperTranscriptionProvider(
            model_size=config.whisper_model_size, device=config.processing_device
        )
        transcription = transcriber.transcribe(vocals_path_for_analysis, language_override=job.get("languageOverride"))
        done(
            "TRANSCRIBE",
            f"Detected language: {transcription.language} ({transcription.language_confidence:.0%} confidence)",
        )

        stage("ALIGN_WORDS", "Word-level timestamps derived from ASR cross-attention alignment")
        done("ALIGN_WORDS", f"{len(transcription.words)} words aligned")

        # ---- DETECT_PITCH ----
        stage("DETECT_PITCH", "Estimating fundamental frequency (pyin) over the isolated vocal")
        vocal_audio, vocal_sr = sf.read(vocals_path_for_analysis, always_2d=False)
        if getattr(vocal_audio, "ndim", 1) > 1:
            vocal_audio = vocal_audio.mean(axis=1)
        raw_frames = estimate_pitch_contour(vocal_audio, vocal_sr)
        smoothed_frames = smooth_pitch_contour(raw_frames)
        pitch_json = [
            {
                "t": f.t,
                "frequencyHz": f.frequency_hz,
                "midi": None,
                "confidence": f.confidence,
                "voiced": f.voiced,
            }
            for f in smoothed_frames
        ]
        from .music_theory import hz_to_midi

        for point in pitch_json:
            if point["frequencyHz"]:
                point["midi"] = hz_to_midi(point["frequencyHz"])
        pitch_asset_path = os.path.join(song_output_dir, "pitch_frames.json")
        with open(pitch_asset_path, "w", encoding="utf-8") as fh:
            json.dump(pitch_json, fh)
        api.register_asset(job_id, "pitch_frames_json", asset_key("pitch_frames.json"), "application/json")
        finalize_asset(pitch_asset_path, "pitch_frames.json", "application/json")
        done("DETECT_PITCH", f"{len(smoothed_frames)} pitch frames analyzed")

        # ---- SIMPLIFY_MELODY ----
        stage("SIMPLIFY_MELODY", "Segmenting the pitch contour into discrete target notes")
        notes = simplify_melody(smoothed_frames)
        vocal_range = compute_vocal_range(notes)
        difficult = find_difficult_parts(notes)
        key_estimate = estimate_key(vocal_audio, vocal_sr) if len(vocal_audio) > vocal_sr else None
        api.submit_melody(
            job_id,
            notes=[
                {
                    "start": n.start,
                    "end": n.end,
                    "midi": n.midi,
                    "noteName": n.note_name,
                    "confidence": n.confidence,
                    "meanFrequencyHz": n.mean_frequency_hz,
                }
                for n in notes
            ],
            vocal_range=(
                {
                    "lowestMidi": vocal_range.lowest_midi,
                    "highestMidi": vocal_range.highest_midi,
                    "lowestNote": vocal_range.lowest_note,
                    "highestNote": vocal_range.highest_note,
                    "semitoneRange": vocal_range.semitone_range,
                    "sampleCount": vocal_range.sample_count,
                }
                if vocal_range
                else None
            ),
            key_estimate=(
                {"tonic": key_estimate.tonic, "mode": key_estimate.mode, "confidence": key_estimate.confidence}
                if key_estimate
                else None
            ),
            difficult_parts=[
                {"start": d.start, "end": d.end, "reason": d.reason, "detail": d.detail, "severity": d.severity}
                for d in difficult
            ],
        )
        done("SIMPLIFY_MELODY", f"{len(notes)} target notes identified")

        # ---- SEGMENT_LYRICS ----
        stage("SEGMENT_LYRICS", "Grouping words into lyric lines")
        line_segments = segment_words_into_lines(transcription.words)
        api.submit_lyrics(
            job_id,
            language=transcription.language,
            language_confidence=transcription.language_confidence,
            lines=[
                {
                    "start": line.start,
                    "end": line.end,
                    "words": [
                        {"text": w.text, "start": w.start, "end": w.end, "confidence": w.confidence} for w in line.words
                    ],
                }
                for line in line_segments
            ],
        )
        sections = detect_sections(line_segments, prepared.duration_sec)
        api.submit_sections(
            job_id,
            sections=[
                {
                    "type": s.type,
                    "label": s.label,
                    "start": s.start,
                    "end": s.end,
                    "confidence": s.confidence,
                    "isEstimated": s.is_estimated,
                }
                for s in sections
            ],
        )
        done("SEGMENT_LYRICS", f"{len(line_segments)} lines across {len(sections)} sections")

        # ---- GENERATE_WAVEFORM ----
        stage("GENERATE_WAVEFORM", "Building the waveform overview")
        ref_audio, ref_sr = sf.read(prepared.path, always_2d=False)
        waveform = generate_waveform(ref_audio, ref_sr)
        waveform_asset_path = os.path.join(song_output_dir, "waveform.json")
        with open(waveform_asset_path, "w", encoding="utf-8") as fh:
            json.dump(
                {
                    "sampleRateHz": waveform.sample_rate_hz,
                    "peaks": waveform.peaks,
                    "durationSec": waveform.duration_sec,
                },
                fh,
            )
        api.register_asset(job_id, "waveform_json", asset_key("waveform.json"), "application/json")
        finalize_asset(waveform_asset_path, "waveform.json", "application/json")
        done("GENERATE_WAVEFORM", f"{len(waveform.peaks)} peaks generated")

        # ---- BUILD_KARAOKE / COMPLETE ----
        stage("BUILD_KARAOKE", "Assembling the final karaoke project")
        done("BUILD_KARAOKE")
        api.update_stage(job_id, "COMPLETE", "done")

    except Exception as exc:
        stage_name = exc.stage if isinstance(exc, PipelineError) else "BUILD_KARAOKE"
        error_text = f"{exc}\n{traceback.format_exc()[-2000:]}"
        try:
            api.update_stage(job_id, stage_name, "failed", error=str(exc))
        finally:
            api.fail_job(job_id, error_text)
        raise


def _copy_into_storage(src_path: str, dest_path: str) -> None:
    import shutil

    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    if os.path.abspath(src_path) != os.path.abspath(dest_path):
        shutil.copyfile(src_path, dest_path)
