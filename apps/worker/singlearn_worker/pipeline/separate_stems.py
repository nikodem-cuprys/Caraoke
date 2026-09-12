"""SEPARATE_STEMS stage.

Vocal/instrumental separation is modeled behind a small SeparationProvider
protocol so the model backing it can be swapped or disabled without
touching the rest of the pipeline:

  - DemucsSeparationProvider: real separation using Meta's Demucs
    (htdemucs, the default 4-stem Hybrid Transformer model). MIT licensed;
    see README.md "Models Used" for the current maintenance situation
    (upstream now maintained at github.com/adefossez/demucs).
  - PassthroughSeparationProvider: used when Demucs isn't installed/enabled
    (e.g. PROCESSING_DEVICE constrained environments, or SEPARATION_ENGINE
    explicitly set to "none"). It does NOT fabricate a fake separation — it
    honestly reports `available=False` so the API/UI can show "isolated
    vocals unavailable" instead of pretending the mixed track is isolated.
"""

from __future__ import annotations

import os
import shutil
from dataclasses import dataclass
from typing import Protocol


@dataclass
class SeparationResult:
    vocals_path: str
    instrumental_path: str
    engine: str
    available: bool


class SeparationProvider(Protocol):
    name: str

    def separate(self, input_wav_path: str, output_dir: str) -> SeparationResult: ...


class PassthroughSeparationProvider:
    """No real separation performed. The 'vocals' output is just the mixed
    track (so transcription/pitch detection still has something to run on),
    and no instrumental track is produced at all."""

    name = "passthrough-no-separation"

    def separate(self, input_wav_path: str, output_dir: str) -> SeparationResult:
        os.makedirs(output_dir, exist_ok=True)
        mixed_copy = os.path.join(output_dir, "mixed_passthrough.wav")
        shutil.copyfile(input_wav_path, mixed_copy)
        return SeparationResult(
            vocals_path=mixed_copy,
            instrumental_path=mixed_copy,
            engine=self.name,
            available=False,
        )


class DemucsSeparationProvider:
    """Real separation via the `demucs` Python package's htdemucs model."""

    name = "demucs-htdemucs"

    def __init__(self, device: str | None = None):
        self.device = device or os.environ.get("PROCESSING_DEVICE", "cpu")

    def separate(self, input_wav_path: str, output_dir: str) -> SeparationResult:
        import torch
        from demucs.api import Separator, save_audio

        os.makedirs(output_dir, exist_ok=True)
        separator = Separator(model="htdemucs", device=self.device, progress=False)
        _origin, stems = separator.separate_audio_file(input_wav_path)

        vocals = stems["vocals"]
        instrumental = torch.zeros_like(vocals)
        for name, tensor in stems.items():
            if name != "vocals":
                instrumental = instrumental + tensor

        vocals_path = os.path.join(output_dir, "vocals.wav")
        instrumental_path = os.path.join(output_dir, "instrumental.wav")
        save_audio(vocals, vocals_path, samplerate=separator.samplerate)
        save_audio(instrumental, instrumental_path, samplerate=separator.samplerate)

        return SeparationResult(
            vocals_path=vocals_path,
            instrumental_path=instrumental_path,
            engine=self.name,
            available=True,
        )


def get_separation_provider(engine: str) -> SeparationProvider:
    if engine == "demucs":
        try:
            import demucs  # noqa: F401

            return DemucsSeparationProvider()
        except ImportError:
            return PassthroughSeparationProvider()
    return PassthroughSeparationProvider()
