from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv()


class Config:
    api_base_url: str = os.environ.get("API_BASE_URL", "http://localhost:4000")
    worker_shared_secret: str = os.environ.get("WORKER_SHARED_SECRET", "dev-worker-secret-change-me")
    poll_interval_sec: float = float(os.environ.get("WORKER_POLL_INTERVAL_SEC", "2"))
    processing_device: str = os.environ.get("PROCESSING_DEVICE", "cpu")  # "cpu" or "cuda"
    whisper_model_size: str = os.environ.get("WHISPER_MODEL_SIZE", "base")
    separation_engine: str = os.environ.get("SEPARATION_ENGINE", "demucs")  # "demucs" or "none"
    work_dir: str = os.environ.get("WORKER_TMP_DIR", "./worker_tmp")


config = Config()
