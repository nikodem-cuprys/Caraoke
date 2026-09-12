"""Exercises run_job() in "remote storage" mode (STORAGE_PROVIDER=s3 on the
API side): no storageLocalRoot, so the worker must download the source audio
via a presigned URL and upload every produced asset via a presigned PUT
instead of reading/writing a filesystem shared with the API. A tiny local
HTTP server stands in for the object store so this stays a fast, offline,
deterministic test rather than requiring a real S3/MinIO instance.
"""

from __future__ import annotations

import http.server
import json
import os
import threading

import pytest
import soundfile as sf

from singlearn_worker.config import config
from singlearn_worker.run_pipeline import run_job

FIXTURE_WAV = os.path.join(os.path.dirname(__file__), "..", "fixtures", "synthetic_song.wav")


class _FakeObjectStoreHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 (BaseHTTPRequestHandler's naming convention)
        if self.path == "/source-audio":
            with open(FIXTURE_WAV, "rb") as fh:
                data = fh.read()
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        else:
            self.send_response(404)
            self.end_headers()

    def do_PUT(self):  # noqa: N802
        prefix = "/upload/"
        if not self.path.startswith(prefix):
            self.send_response(404)
            self.end_headers()
            return
        key = self.path[len(prefix) :]
        length = int(self.headers.get("Content-Length", 0))
        data = self.rfile.read(length)
        self.server.uploads[key] = data  # type: ignore[attr-defined]
        self.send_response(200)
        self.end_headers()

    def log_message(self, format, *args):  # noqa: A002 (matches base class signature)
        pass  # keep test output quiet


class _FakeObjectStore(http.server.ThreadingHTTPServer):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.uploads: dict[str, bytes] = {}


@pytest.fixture
def fake_object_store():
    server = _FakeObjectStore(("127.0.0.1", 0), _FakeObjectStoreHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        thread.join(timeout=5)


class FakeApiClient:
    def __init__(self, base_url: str):
        self.base_url = base_url
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

    def get_upload_url(self, job_id: str, key: str, content_type: str) -> str:
        return f"{self.base_url}/upload/{key}"

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


@pytest.mark.skipif(not os.path.exists(FIXTURE_WAV), reason="fixture not generated; run fixtures/generate_fixture.py")
def test_run_job_downloads_source_and_uploads_every_asset_via_presigned_urls(tmp_path, monkeypatch, fake_object_store):
    # Passthrough separation keeps this test fast and focused on the
    # remote-storage plumbing; real Demucs separation (and its stem uploads)
    # is covered by test_separation_integration.py plus a manual smoke test.
    monkeypatch.setattr(config, "separation_engine", "none")
    monkeypatch.setattr(config, "work_dir", str(tmp_path / "work"))

    base_url = f"http://127.0.0.1:{fake_object_store.server_port}"
    api = FakeApiClient(base_url)

    job = {
        "jobId": "job-remote",
        "songId": "song-remote",
        "sourceAudioLocalPath": None,
        "sourceAudioSignedUrl": f"{base_url}/source-audio",
        "sourceAudioMimeType": "audio/wav",
        "storageKeyPrefix": "songs/song-remote/",
        "storageLocalRoot": None,
        "languageOverride": None,
    }

    run_job(job, api)

    assert api.failures == []
    done_stage_names = [u["name"] for u in api.stage_updates if u["status"] == "done"]
    assert done_stage_names[-1] == "COMPLETE"

    # Every registered asset must actually have been uploaded to the object
    # store under the exact key the API was told about, not just written to
    # a local temp file and forgotten.
    uploaded_keys = set(fake_object_store.uploads.keys())
    for asset in api.assets:
        assert asset["storageKey"] in uploaded_keys, f"{asset['storageKey']} was registered but never uploaded"

    prepared_bytes = fake_object_store.uploads["songs/song-remote/prepared_reference.wav"]
    assert prepared_bytes[:4] == b"RIFF"  # a real WAV file, not a placeholder

    pitch_frames = json.loads(fake_object_store.uploads["songs/song-remote/pitch_frames.json"])
    assert len(pitch_frames) > 10
    assert any(f["voiced"] for f in pitch_frames)

    waveform = json.loads(fake_object_store.uploads["songs/song-remote/waveform.json"])
    assert len(waveform["peaks"]) > 0

    assert len(api.lyrics_calls) == 1
    words = [w["text"].strip(".,!?").lower() for line in api.lyrics_calls[0]["lines"] for w in line["words"]]
    assert words == ["the", "sun", "will", "rise", "again", "tomorrow"]


@pytest.mark.skipif(not os.path.exists(FIXTURE_WAV), reason="fixture not generated; run fixtures/generate_fixture.py")
def test_run_job_uploads_real_stems_when_separation_is_available(tmp_path, monkeypatch, fake_object_store):
    demucs = pytest.importorskip("demucs")  # noqa: F841
    monkeypatch.setattr(config, "separation_engine", "demucs")
    monkeypatch.setattr(config, "work_dir", str(tmp_path / "work"))

    base_url = f"http://127.0.0.1:{fake_object_store.server_port}"
    api = FakeApiClient(base_url)

    job = {
        "jobId": "job-remote-stems",
        "songId": "song-remote-stems",
        "sourceAudioLocalPath": None,
        "sourceAudioSignedUrl": f"{base_url}/source-audio",
        "sourceAudioMimeType": "audio/wav",
        "storageKeyPrefix": "songs/song-remote-stems/",
        "storageLocalRoot": None,
        "languageOverride": None,
    }

    run_job(job, api)

    assert api.failures == []
    vocals_bytes = fake_object_store.uploads["songs/song-remote-stems/vocals.wav"]
    instrumental_bytes = fake_object_store.uploads["songs/song-remote-stems/instrumental.wav"]
    assert vocals_bytes[:4] == b"RIFF"
    assert instrumental_bytes[:4] == b"RIFF"
    assert vocals_bytes != instrumental_bytes

    tmp_vocals = tmp_path / "vocals_check.wav"
    tmp_vocals.write_bytes(vocals_bytes)
    audio, sr = sf.read(str(tmp_vocals))
    assert sr > 0
    assert len(audio) > 0
