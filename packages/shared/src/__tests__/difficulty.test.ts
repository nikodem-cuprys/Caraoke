import { describe, expect, it } from "vitest";
import { estimateSongDifficulty } from "../difficulty";
import type { DifficultPartDTO, LyricLineDTO, VocalRangeDTO } from "../types";

function vocalRange(semitoneRange: number): VocalRangeDTO {
  return {
    lowestMidi: 60,
    highestMidi: 60 + semitoneRange,
    lowestNote: "C4",
    highestNote: "C5",
    semitoneRange,
    sampleCount: 100,
  };
}

function difficultPart(severity: number): DifficultPartDTO {
  return { id: `p-${severity}`, start: 0, end: 1, reason: "large_interval_jump", detail: "estimate", severity };
}

function lineWithWords(wordCount: number, start: number, end: number): LyricLineDTO {
  return {
    id: `line-${start}`,
    index: 0,
    start,
    end,
    sectionId: null,
    words: Array.from({ length: wordCount }, (_, i) => ({
      id: `w-${start}-${i}`,
      text: "la",
      start: start + i * 0.1,
      end: start + i * 0.1 + 0.05,
      confidence: 0.9,
      isUserCorrected: false,
      lowConfidence: false,
    })),
  };
}

describe("estimateSongDifficulty", () => {
  it("returns null without a confident vocal range rather than guessing", () => {
    expect(
      estimateSongDifficulty({ vocalRange: null, difficultParts: [], lines: [], durationSec: 180 })
    ).toBeNull();
  });

  it("returns null for a non-positive duration", () => {
    expect(
      estimateSongDifficulty({ vocalRange: vocalRange(12), difficultParts: [], lines: [], durationSec: 0 })
    ).toBeNull();
  });

  it("rates a narrow range, no difficult parts, and sparse lyrics as easy", () => {
    const result = estimateSongDifficulty({
      vocalRange: vocalRange(7),
      difficultParts: [],
      lines: [lineWithWords(20, 0, 60)], // ~0.33 words/sec over 180s
      durationSec: 180,
    });
    expect(result?.level).toBe("easy");
    expect(result?.factors[0]).toContain("7 semitones");
  });

  it("rates a wide range, severe difficult parts, and dense lyrics as difficult", () => {
    const manyWords = Array.from({ length: 20 }, (_, i) => lineWithWords(20, i * 9, i * 9 + 8));
    const result = estimateSongDifficulty({
      vocalRange: vocalRange(30),
      difficultParts: [difficultPart(1), difficultPart(1), difficultPart(1), difficultPart(1), difficultPart(1)],
      lines: manyWords, // 400 words over 180s ~= 2.2 words/sec... bump duration down to push density higher
      durationSec: 100,
    });
    expect(result?.level).toBe("difficult");
  });

  it("includes a difficult-parts factor only when some exist", () => {
    const withParts = estimateSongDifficulty({
      vocalRange: vocalRange(12),
      difficultParts: [difficultPart(0.8)],
      lines: [],
      durationSec: 180,
    });
    expect(withParts?.factors.some((f) => f.includes("difficult passage"))).toBe(true);

    const withoutParts = estimateSongDifficulty({
      vocalRange: vocalRange(12),
      difficultParts: [],
      lines: [],
      durationSec: 180,
    });
    expect(withoutParts?.factors.some((f) => f.includes("difficult passage"))).toBe(false);
  });

  it("includes a lyrics-density factor only when there are words", () => {
    const withWords = estimateSongDifficulty({
      vocalRange: vocalRange(12),
      difficultParts: [],
      lines: [lineWithWords(10, 0, 5)],
      durationSec: 180,
    });
    expect(withWords?.factors.some((f) => f.includes("words/sec"))).toBe(true);

    const withoutWords = estimateSongDifficulty({
      vocalRange: vocalRange(12),
      difficultParts: [],
      lines: [],
      durationSec: 180,
    });
    expect(withoutWords?.factors.some((f) => f.includes("words/sec"))).toBe(false);
  });
});
