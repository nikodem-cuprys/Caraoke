"""Thin HTTP client the worker uses to talk to the Node API's /internal/*
endpoints. The worker never touches the database or Redis directly — this
keeps its credentials limited to a single shared secret and keeps the
"what job is next" decision entirely in the API (see apps/api/src/queue).
"""

from __future__ import annotations

from typing import Any

import requests

from .config import config


class ApiClient:
    def __init__(self, base_url: str | None = None, secret: str | None = None):
        self.base_url = (base_url or config.api_base_url).rstrip("/")
        self.headers = {"X-Worker-Secret": secret or config.worker_shared_secret}

    def claim_job(self) -> dict[str, Any] | None:
        resp = requests.get(f"{self.base_url}/internal/queue/claim", headers=self.headers, timeout=10)
        resp.raise_for_status()
        return resp.json().get("job")

    def update_stage(
        self,
        job_id: str,
        name: str,
        status: str,
        progress: float | None = None,
        detail: str | None = None,
        error: str | None = None,
    ) -> None:
        resp = requests.post(
            f"{self.base_url}/internal/jobs/{job_id}/stage",
            headers=self.headers,
            json={"name": name, "status": status, "progress": progress, "detail": detail, "error": error},
            timeout=10,
        )
        resp.raise_for_status()

    def register_asset(
        self,
        job_id: str,
        kind: str,
        storage_key: str,
        mime_type: str,
        duration_sec: float | None = None,
        size_bytes: int | None = None,
        provider_name: str | None = None,
    ) -> None:
        resp = requests.post(
            f"{self.base_url}/internal/jobs/{job_id}/assets",
            headers=self.headers,
            json={
                "kind": kind,
                "storageKey": storage_key,
                "mimeType": mime_type,
                "durationSec": duration_sec,
                "sizeBytes": size_bytes,
                "providerName": provider_name,
            },
            timeout=10,
        )
        resp.raise_for_status()

    def submit_lyrics(self, job_id: str, language: str, language_confidence: float, lines: list[dict]) -> None:
        resp = requests.post(
            f"{self.base_url}/internal/jobs/{job_id}/lyrics",
            headers=self.headers,
            json={"language": language, "languageConfidence": language_confidence, "lines": lines},
            timeout=30,
        )
        resp.raise_for_status()

    def submit_sections(self, job_id: str, sections: list[dict]) -> None:
        resp = requests.post(
            f"{self.base_url}/internal/jobs/{job_id}/sections",
            headers=self.headers,
            json={"sections": sections},
            timeout=15,
        )
        resp.raise_for_status()

    def submit_melody(
        self,
        job_id: str,
        notes: list[dict],
        vocal_range: dict | None,
        key_estimate: dict | None,
        difficult_parts: list[dict],
    ) -> None:
        resp = requests.post(
            f"{self.base_url}/internal/jobs/{job_id}/melody",
            headers=self.headers,
            json={
                "notes": notes,
                "vocalRange": vocal_range,
                "keyEstimate": key_estimate,
                "difficultParts": difficult_parts,
            },
            timeout=30,
        )
        resp.raise_for_status()

    def fail_job(self, job_id: str, error: str) -> None:
        resp = requests.post(
            f"{self.base_url}/internal/jobs/{job_id}/fail", headers=self.headers, json={"error": error}, timeout=10
        )
        resp.raise_for_status()
