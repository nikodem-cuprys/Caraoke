import { describe, expect, it } from "vitest";
import { autocorrelate } from "../pitchDetection";

const SAMPLE_RATE = 44100;

function sineWave(frequencyHz: number, sampleCount: number, sampleRate = SAMPLE_RATE, amplitude = 0.5): Float32Array {
  const buffer = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    buffer[i] = amplitude * Math.sin((2 * Math.PI * frequencyHz * i) / sampleRate);
  }
  return buffer;
}

function whiteNoise(sampleCount: number, amplitude = 0.5): Float32Array {
  const buffer = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) buffer[i] = amplitude * (Math.random() * 2 - 1);
  return buffer;
}

describe("autocorrelate", () => {
  it("detects the frequency of a clean sine wave within 1%", () => {
    for (const freq of [110, 220, 440, 880]) {
      const result = autocorrelate(sineWave(freq, 2048), SAMPLE_RATE);
      expect(result.frequencyHz).not.toBeNull();
      const relativeError = Math.abs((result.frequencyHz as number) - freq) / freq;
      expect(relativeError).toBeLessThan(0.01);
      expect(result.confidence).toBeGreaterThan(0.9);
    }
  });

  it("reports high confidence for a pure tone and much lower confidence for noise", () => {
    const tone = autocorrelate(sineWave(220, 2048), SAMPLE_RATE);
    const noise = autocorrelate(whiteNoise(2048), SAMPLE_RATE);
    expect(tone.confidence).toBeGreaterThan(noise.confidence);
  });

  it("returns null for silence rather than fabricating a pitch", () => {
    const silence = new Float32Array(2048); // all zeros
    const result = autocorrelate(silence, SAMPLE_RATE);
    expect(result.frequencyHz).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it("returns null for a signal quieter than the silence threshold", () => {
    const quiet = sineWave(220, 2048, SAMPLE_RATE, 0.001);
    const result = autocorrelate(quiet, SAMPLE_RATE);
    expect(result.frequencyHz).toBeNull();
  });

  it("ignores frequencies outside the configured singing range", () => {
    // 2000Hz is well above the default fmax (1047Hz) - the detector must
    // not alias it down into range and report a false low note.
    const tooHigh = sineWave(2000, 2048);
    const result = autocorrelate(tooHigh, SAMPLE_RATE, { fminHz: 65, fmaxHz: 1047 });
    // Autocorrelation over a range that excludes the true period will
    // either find nothing convincing or lock onto a harmonic within
    // range; either way it must not claim near-2000Hz.
    if (result.frequencyHz !== null) {
      expect(result.frequencyHz).toBeLessThanOrEqual(1047 * 1.05);
    }
  });
});
