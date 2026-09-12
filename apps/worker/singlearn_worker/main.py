"""Worker entrypoint: polls the API for the next queued job and runs it.

Run with: python -m singlearn_worker.main
"""

from __future__ import annotations

import logging
import time

from .api_client import ApiClient
from .config import config
from .run_pipeline import run_job

logging.basicConfig(level=logging.INFO, format="%(asctime)s [worker] %(message)s")
log = logging.getLogger("singlearn_worker")


def main() -> None:
    api = ApiClient()
    log.info(
        "SingLearn worker started. Polling %s every %.1fs (device=%s)",
        config.api_base_url,
        config.poll_interval_sec,
        config.processing_device,
    )
    while True:
        try:
            job = api.claim_job()
        except Exception as exc:  # noqa: BLE001
            log.error("Failed to poll for jobs: %s", exc)
            time.sleep(config.poll_interval_sec)
            continue

        if not job:
            time.sleep(config.poll_interval_sec)
            continue

        log.info("Claimed job %s for song %s", job["jobId"], job["songId"])
        try:
            run_job(job, api)
            log.info("Job %s complete", job["jobId"])
        except Exception as exc:  # noqa: BLE001
            log.error("Job %s failed: %s", job["jobId"], exc)


if __name__ == "__main__":
    main()
