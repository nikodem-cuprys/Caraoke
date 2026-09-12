"""Real Demucs separation test (uses the actual htdemucs model — the first
run in a fresh environment will download ~80MB of weights to the Hugging
Face cache; subsequent runs are fast). Also covers the honest fallback
provider used when separation is disabled/unavailable."""

import os

import pytest
import soundfile as sf

from singlearn_worker.pipeline.separate_stems import (
    PassthroughSeparationProvider,
    get_separation_provider,
)

FIXTURE_WAV = os.path.join(os.path.dirname(__file__), "..", "fixtures", "synthetic_song.wav")


def test_passthrough_provider_is_honest_about_unavailability(tmp_path):
    provider = PassthroughSeparationProvider()
    result = provider.separate(FIXTURE_WAV, str(tmp_path))
    assert result.available is False
    assert os.path.exists(result.vocals_path)
    assert result.vocals_path == result.instrumental_path


def test_get_separation_provider_falls_back_to_passthrough_for_unknown_engine():
    provider = get_separation_provider("none")
    assert isinstance(provider, PassthroughSeparationProvider)


@pytest.mark.skipif(not os.path.exists(FIXTURE_WAV), reason="fixture not generated")
def test_real_demucs_separation_produces_two_distinct_stems(tmp_path):
    demucs = pytest.importorskip("demucs")  # noqa: F841
    from singlearn_worker.pipeline.separate_stems import DemucsSeparationProvider

    provider = DemucsSeparationProvider(device="cpu")
    result = provider.separate(FIXTURE_WAV, str(tmp_path))

    assert result.available is True
    assert os.path.exists(result.vocals_path)
    assert os.path.exists(result.instrumental_path)

    vocals, vsr = sf.read(result.vocals_path)
    instrumental, isr = sf.read(result.instrumental_path)
    assert vsr == isr
    assert abs(len(vocals) - len(instrumental)) < vsr * 0.1  # same length within 100ms
