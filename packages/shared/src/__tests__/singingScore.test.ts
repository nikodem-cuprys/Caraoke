import { describe, expect, it } from "vitest";
import { midiToHz } from "../music";
import { buildSingingFeedback, type PitchSample } from "../singingScore";
import type { LyricLineDTO, MelodyNoteDTO } from "../types";

function note(overrides: Partial<MelodyNoteDTO> & Pick<MelodyNoteDTO, "start" | "end" | "midi">): MelodyNoteDTO {
  return {
    id: `note-${overrides.start}`,
    noteName: "A4",
    confidence: 0.9,
    meanFrequencyHz: midiToHz(overrides.midi),
    ...overrides,
  };
}

function line(overrides: Partial<LyricLineDTO> & Pick<LyricLineDTO, "start" | "end">): LyricLineDTO {
  return {
    id: `line-${overrides.start}`,
    index: 0,
    sectionId: null,
    words: [],
    ...overrides,
  };
}

function centsToFrequency(baseMidi: number, cents: number): number {
  return midiToHz(baseMidi + cents / 100);
}

describe("buildSingingFeedback", () => {
  it("returns an encouraging fallback when there is no matched signal", () => {
    const insights = buildSingingFeedback([], [note({ start: 0, end: 1, midi: 69 })], []);
    expect(insights).toHaveLength(1);
    expect(insights[0].kind).toBe("encouragement");
  });

  it("does not flag normal vibrato (symmetric oscillation) as a pitch tendency", () => {
    const targetMidi = 69; // A4
    const samples: PitchSample[] = [];
    // ~6Hz vibrato swinging +-40 cents around the target, sampled every 20ms.
    for (let i = 0; i < 50; i++) {
      const t = i * 0.02;
      const cents = 40 * Math.sin(2 * Math.PI * 6 * t);
      samples.push({ t, frequencyHz: centsToFrequency(targetMidi, cents), confidence: 0.9 });
    }
    const notes = [note({ start: 0, end: 1, midi: targetMidi })];
    const insights = buildSingingFeedback(samples, notes, []);
    const tendency = insights.find((i) => i.kind === "pitch_tendency");
    expect(tendency?.text).toMatch(/close to the target/);
  });

  it("flags a consistent flat tendency across a whole phrase", () => {
    const targetMidi = 69;
    const samples: PitchSample[] = [];
    for (let i = 0; i < 30; i++) {
      samples.push({ t: i * 0.02, frequencyHz: centsToFrequency(targetMidi, -35), confidence: 0.9 });
    }
    const notes = [note({ start: 0, end: 1, midi: targetMidi })];
    const insights = buildSingingFeedback(samples, notes, []);
    const tendency = insights.find((i) => i.kind === "pitch_tendency");
    expect(tendency?.text).toContain("35 cents flat");
  });

  it("identifies a specific note that is consistently sharp", () => {
    const inTuneNote = note({ start: 0, end: 1, midi: 69 });
    const sharpNote = note({ start: 1, end: 2, midi: 72 });
    const samples: PitchSample[] = [];
    for (let i = 0; i < 20; i++) samples.push({ t: i * 0.05, frequencyHz: centsToFrequency(69, 0), confidence: 0.9 });
    for (let i = 0; i < 20; i++) samples.push({ t: 1 + i * 0.05, frequencyHz: centsToFrequency(72, 30), confidence: 0.9 });

    const insights = buildSingingFeedback(samples, [inTuneNote, sharpNote], []);
    const deviation = insights.find((i) => i.kind === "note_deviation");
    expect(deviation?.text).toContain("above the target");
    expect(deviation?.text).toContain(sharpNote.noteName);
  });

  it("flags a late entrance into a phrase", () => {
    const targetMidi = 69;
    const theLine = line({ start: 0, end: 2 });
    const notes = [note({ start: 0, end: 2, midi: targetMidi })];
    // First voiced sample doesn't appear until 300ms into the line.
    const samples: PitchSample[] = [];
    for (let i = 0; i < 20; i++) {
      const t = 0.3 + i * 0.05;
      samples.push({ t, frequencyHz: centsToFrequency(targetMidi, 0), confidence: 0.9 });
    }
    const insights = buildSingingFeedback(samples, notes, [theLine]);
    const timing = insights.find((i) => i.kind === "timing_onset");
    expect(timing?.text).toMatch(/approximately 3\d\dms late/);
  });

  it("flags low note coverage when most of the target notes were never attempted", () => {
    const notes = [
      note({ start: 0, end: 1, midi: 69 }),
      note({ start: 1, end: 2, midi: 71 }),
      note({ start: 2, end: 3, midi: 72 }),
      note({ start: 3, end: 4, midi: 74 }),
      note({ start: 4, end: 5, midi: 76 }),
    ];
    // Only sang during the first note's window.
    const samples: PitchSample[] = [{ t: 0.5, frequencyHz: centsToFrequency(69, 0), confidence: 0.9 }];
    const insights = buildSingingFeedback(samples, notes, []);
    const coverage = insights.find((i) => i.kind === "note_coverage");
    expect(coverage).toBeDefined();
    expect(coverage?.text).toMatch(/\d+%/);
  });

  it("ignores low-confidence target notes and low-confidence observed samples", () => {
    const uncertainNote = note({ start: 0, end: 1, midi: 69, confidence: 0.2 });
    const samples: PitchSample[] = [{ t: 0.5, frequencyHz: centsToFrequency(69, -80), confidence: 0.9 }];
    const insights = buildSingingFeedback(samples, [uncertainNote], []);
    expect(insights).toHaveLength(1);
    expect(insights[0].kind).toBe("encouragement");

    const confidentNote = note({ start: 0, end: 1, midi: 69, confidence: 0.9 });
    const lowConfidenceSamples: PitchSample[] = [{ t: 0.5, frequencyHz: centsToFrequency(69, -80), confidence: 0.1 }];
    const insights2 = buildSingingFeedback(lowConfidenceSamples, [confidentNote], []);
    expect(insights2).toHaveLength(1);
    expect(insights2[0].kind).toBe("encouragement");
  });
});
