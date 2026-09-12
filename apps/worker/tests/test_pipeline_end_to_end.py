"""End-to-end test of run_job(): drives the real audio pipeline (ffmpeg
prepare, passthrough separation, real faster-whisper transcription, real
pyin pitch detection, melody/section/waveform generation) against the
checked-in synthetic fixture, using a fake API client that records every
call instead of making HTTP requests. This is the closest thing to
"process a legal test song end-to-end" that can run without a live API
server or network access beyond the one-time model download.
"""

import json
import os

import pytest

from singlearn_worker.config import config
from singlearn_worker.run_pipeline import run_job

FIXTURE_WAV = os.path.join(os.path.dirname(__file__), "..", "fixtures", "synthetic_song.wav")


class FakeApiClient:
    def __init__(self):
        self.stage_updates: list[dict] = []
        self.assets: list[dict] = []
        self.lyrics_calls: list[dict] = []
        self.section_calls: list[dict] = []
        self.melody_calls: list[dict] = []
        self.failures: list[str] = []

    def update_stage(self, job_id, name, status, progress=None, detail=None, error=None):
        self.stage_updates.append({"jobId": job_id, "name": name, "status": status, "detail": detail, "error": error})

    def register_asset(
        self, job_id, kind, storage_key, mime_type, duration_sec=None, size_bytes=None, provider_name=None
    ):
        self.assets.append({"kind": kind, "storageKey": storage_key, "mimeType": mime_type})

    def submit_lyrics(self, job_id, language, language_confidence, lines):
        self.lyrics_calls.append({"language": language, "lines": lines})

    def submit_sections(self, job_id, sections):
        self.section_calls.append(sections)

    def submit_melody(self, job_id, notes, vocal_range, key_estimate, difficult_parts):
        self.melody_calls.append(
            {"notes": notes, "vocalRange": vocal_range, "keyEstimate": key_estimate, "difficultParts": difficult_parts}
        )

    def fail_job(self, job_id, error):
        self.failures.append(error)


EXPECTED_STAGE_ORDER = [
    "PREPARE_AUDIO",
    "SEPARATE_STEMS",
    "TRANSCRIBE",
    "ALIGN_WORDS",
    "DETECT_PITCH",
    "SIMPLIFY_MELODY",
    "SEGMENT_LYRICS",
    "GENERATE_WAVEFORM",
    "BUILD_KARAOKE",
    "COMPLETE",
]


@pytest.mark.skipif(not os.path.exists(FIXTURE_WAV), reason="fixture not generated; run fixtures/generate_fixture.py")
def test_full_pipeline_runs_end_to_end_on_synthetic_fixture(tmp_path, monkeypatch):
    # Passthrough separation keeps this test fast and focused on
    # orchestration correctness; real Demucs separation is independently
    # verified in test_separation_integration.py.
    monkeypatch.setattr(config, "separation_engine", "none")

    storage_root = tmp_path / "storage"
    storage_root.mkdir()
    work_dir = tmp_path / "work"
    work_dir.mkdir()
    monkeypatch.setattr(config, "work_dir", str(work_dir))

    job = {
        "jobId": "job-1",
        "songId": "song-1",
        "sourceAudioLocalPath": FIXTURE_WAV,
        "storageKeyPrefix": "songs/song-1/",
        "storageLocalRoot": str(storage_root),
        "languageOverride": None,
    }

    api = FakeApiClient()
    run_job(job, api)

    assert api.failures == []

    done_stage_names = [u["name"] for u in api.stage_updates if u["status"] == "done"]
    for expected in EXPECTED_STAGE_ORDER:
        assert expected in done_stage_names, f"stage {expected} never reported done"
    assert done_stage_names[-1] == "COMPLETE"

    asset_kinds = {a["kind"] for a in api.assets}
    assert "prepared_reference" in asset_kinds
    assert "pitch_frames_json" in asset_kinds
    assert "waveform_json" in asset_kinds

    assert len(api.lyrics_calls) == 1
    words = [w["text"].strip(".,!?").lower() for line in api.lyrics_calls[0]["lines"] for w in line["words"]]
    assert words == ["the", "sun", "will", "rise", "again", "tomorrow"]

    assert len(api.section_calls) == 1
    assert len(api.melody_calls) == 1

    # The pitch-frames JSON artifact was actually written to the storage root.
    pitch_path = storage_root / "songs" / "song-1" / "pitch_frames.json"
    assert pitch_path.exists()
    with open(pitch_path, encoding="utf-8") as fh:
        frames = json.load(fh)
    assert len(frames) > 10
    assert any(f["voiced"] for f in frames)

    waveform_path = storage_root / "songs" / "song-1" / "waveform.json"
    assert waveform_path.exists()

    prepared_path = storage_root / "songs" / "song-1" / "prepared_reference.wav"
    assert prepared_path.exists()


@pytest.mark.skipif(not os.path.exists(FIXTURE_WAV), reason="fixture not generated")
def test_pipeline_reports_failure_instead_of_silently_succeeding(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "separation_engine", "none")
    monkeypatch.setattr(config, "work_dir", str(tmp_path / "work"))

    job = {
        "jobId": "job-bad",
        "songId": "song-bad",
        "sourceAudioLocalPath": "/nonexistent/path/does_not_exist.wav",
        "storageKeyPrefix": "songs/song-bad/",
        "storageLocalRoot": str(tmp_path / "storage"),
        "languageOverride": None,
    }

    api = FakeApiClient()
    with pytest.raises(RuntimeError):
        run_job(job, api)

    assert len(api.failures) == 1
    failed_stage_updates = [u for u in api.stage_updates if u["status"] == "failed"]
    assert len(failed_stage_updates) == 1
