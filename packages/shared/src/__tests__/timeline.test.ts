import { describe, expect, it } from "vitest";
import {
  computeLineLoopRegion,
  computeSectionLoopRegion,
  downsamplePitchPoints,
  findActiveLine,
  findActiveWord,
  findNextLine,
  findPreviousLine,
  isValidPlaybackSpeed,
  nextLoopSeekTime,
  rewindBySeconds,
  speedToPlaybackRate,
} from "../timeline";
import type { LyricLineDTO, LyricWordDTO, PitchPointDTO } from "../types";

function makeWord(text: string, start: number, end: number): LyricWordDTO {
  return { id: `${text}-${start}`, text, start, end, confidence: 0.9, isUserCorrected: false, lowConfidence: false };
}

function makeLine(index: number, start: number, end: number, words: LyricWordDTO[]): LyricLineDTO {
  return { id: `line-${index}`, index, start, end, sectionId: null, words };
}

const lines: LyricLineDTO[] = [
  makeLine(0, 0, 2, [makeWord("hello", 0, 0.6), makeWord("world", 0.6, 2)]),
  makeLine(1, 3, 5, [makeWord("second", 3, 4), makeWord("line", 4, 5)]),
  makeLine(2, 6, 8, [makeWord("third", 6, 7), makeWord("line", 7, 8)]),
];

describe("findActiveLine / findActiveWord", () => {
  it("finds the line containing time t", () => {
    expect(findActiveLine(lines, 0.5)?.id).toBe("line-0");
    expect(findActiveLine(lines, 3.5)?.id).toBe("line-1");
  });

  it("returns null between lines", () => {
    expect(findActiveLine(lines, 2.5)).toBeNull();
  });

  it("finds the active word inside a line", () => {
    expect(findActiveWord(lines[0].words, 0.1)?.text).toBe("hello");
    expect(findActiveWord(lines[0].words, 1.0)?.text).toBe("world");
  });
});

describe("findNextLine / findPreviousLine", () => {
  it("finds next line strictly after t", () => {
    expect(findNextLine(lines, 0.5)?.id).toBe("line-1");
    expect(findNextLine(lines, 7.9)).toBeNull();
  });

  it("finds previous line", () => {
    expect(findPreviousLine(lines, 3.5)?.id).toBe("line-1");
    expect(findPreviousLine(lines, 0)).toBeNull();
  });
});

describe("computeLineLoopRegion", () => {
  it("applies preroll without crossing into the previous line", () => {
    const region = computeLineLoopRegion(lines[1], 1.5, 100, lines[0].end);
    // preroll would want start at 3 - 1.5 = 1.5, but previous line ends at 2
    expect(region.start).toBe(2);
    expect(region.end).toBe(5);
  });

  it("clamps preroll at song start for the first line", () => {
    const region = computeLineLoopRegion(lines[0], 5, 100, 0);
    expect(region.start).toBe(0);
    expect(region.end).toBe(2);
  });
});

describe("computeSectionLoopRegion", () => {
  it("clamps end to song duration", () => {
    const region = computeSectionLoopRegion({ id: "s1", type: "chorus", label: "Chorus", start: 10, end: 20, confidence: 0.8, isEstimated: true }, 2, 15);
    expect(region.start).toBe(8);
    expect(region.end).toBe(15);
  });
});

describe("nextLoopSeekTime", () => {
  it("returns loop start once current time reaches the end", () => {
    expect(nextLoopSeekTime(5, { start: 1, end: 5 })).toBe(1);
    expect(nextLoopSeekTime(4.9, { start: 1, end: 5 })).toBeNull();
  });
});

describe("rewindBySeconds", () => {
  it("subtracts seconds and clamps at 0", () => {
    expect(rewindBySeconds(10, 5)).toBe(5);
    expect(rewindBySeconds(3, 5)).toBe(0);
  });
});

describe("speed helpers", () => {
  it("validates the allowed speed set", () => {
    expect(isValidPlaybackSpeed(0.75)).toBe(true);
    expect(isValidPlaybackSpeed(1.25)).toBe(false);
  });

  it("maps speed directly to playbackRate (browser preserves pitch by default)", () => {
    expect(speedToPlaybackRate(0.5)).toBe(0.5);
  });
});

describe("downsamplePitchPoints", () => {
  function makePoints(n: number): PitchPointDTO[] {
    return Array.from({ length: n }, (_, i) => ({
      t: i * 0.01,
      frequencyHz: 440,
      midi: 69,
      confidence: 1,
      voiced: true,
    }));
  }

  it("returns input unchanged when already under the cap", () => {
    const points = makePoints(50);
    expect(downsamplePitchPoints(points, 100)).toHaveLength(50);
  });

  it("decimates to at most maxPoints", () => {
    const points = makePoints(10000);
    const result = downsamplePitchPoints(points, 500);
    expect(result.length).toBe(500);
  });

  it("preserves first and last coverage across the full range", () => {
    const points = makePoints(1000);
    const result = downsamplePitchPoints(points, 100);
    expect(result[0].t).toBe(0);
    expect(result[result.length - 1].t).toBeLessThan(points[points.length - 1].t + 0.01);
  });
});
