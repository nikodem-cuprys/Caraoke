import path from "node:path";
import { describe, expect, it } from "vitest";
import { probeAudioFile, UnsupportedAudioError } from "../services/audioProbe";

describe("probeAudioFile", () => {
  it("reads duration and codec from a real wav fixture via ffprobe", async () => {
    const result = await probeAudioFile(path.join(__dirname, "fixtures", "tiny.wav"));
    expect(result.durationSec).toBeGreaterThan(1.9);
    expect(result.durationSec).toBeLessThan(2.2);
    expect(result.codec).toBe("pcm_s16le");
    expect(result.sampleRate).toBe(44100);
  });

  it("throws UnsupportedAudioError for a non-audio file", async () => {
    await expect(probeAudioFile(path.join(__dirname, "fixtures", "not_audio.txt"))).rejects.toBeInstanceOf(
      UnsupportedAudioError
    );
  });
});
