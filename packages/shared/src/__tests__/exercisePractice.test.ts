import { describe, expect, it } from "vitest";
import { midiToHz } from "../music";
import { evaluateExerciseAttempt, type ExerciseAttemptSample } from "../exercisePractice";
import type { MelodyNoteDTO } from "../types";

function note(overrides: Partial<MelodyNoteDTO> & Pick<MelodyNoteDTO, "start" | "end" | "midi">): MelodyNoteDTO {
  return {
    id: `note-${overrides.start}`,
    noteName: "A4",
    confidence: 0.9,
    meanFrequencyHz: midiToHz(overrides.midi),
    ...overrides,
  };
}

function centsToFrequency(baseMidi: number, cents: number): number {
  return midiToHz(baseMidi + cents / 100);
}

describe("evaluateExerciseAttempt", () => {
  it("reports not enough signal when there are too few matched samples", () => {
    const samples: ExerciseAttemptSample[] = [{ t: 0.1, frequencyHz: centsToFrequency(69, 0), confidence: 0.9 }];
    const result = evaluateExerciseAttempt(samples, [note({ start: 0, end: 1, midi: 69 })]);
    expect(result.hasEnoughSignal).toBe(false);
    expect(result.isClean).toBe(false);
  });

  it("marks a well-sung, fully-covered attempt clean", () => {
    const notes = [note({ start: 0, end: 1, midi: 69 })];
    const samples: ExerciseAttemptSample[] = Array.from({ length: 10 }, (_, i) => ({
      t: i * 0.1,
      frequencyHz: centsToFrequency(69, 5),
      confidence: 0.9,
    }));
    const result = evaluateExerciseAttempt(samples, notes);
    expect(result.hasEnoughSignal).toBe(true);
    expect(result.isClean).toBe(true);
    expect(result.coveragePct).toBe(100);
  });

  it("marks a consistently far-off-pitch attempt not clean", () => {
    const notes = [note({ start: 0, end: 1, midi: 69 })];
    const samples: ExerciseAttemptSample[] = Array.from({ length: 10 }, (_, i) => ({
      t: i * 0.1,
      frequencyHz: centsToFrequency(69, 80),
      confidence: 0.9,
    }));
    const result = evaluateExerciseAttempt(samples, notes);
    expect(result.hasEnoughSignal).toBe(true);
    expect(result.isClean).toBe(false);
  });

  it("marks an attempt with low note coverage not clean even if the sung notes were in tune", () => {
    const notes = [
      note({ start: 0, end: 1, midi: 69 }),
      note({ start: 1, end: 2, midi: 71 }),
      note({ start: 2, end: 3, midi: 72 }),
    ];
    // Only voiced during the first note's window.
    const samples: ExerciseAttemptSample[] = Array.from({ length: 10 }, (_, i) => ({
      t: i * 0.05,
      frequencyHz: centsToFrequency(69, 0),
      confidence: 0.9,
    }));
    const result = evaluateExerciseAttempt(samples, notes);
    expect(result.hasEnoughSignal).toBe(true);
    expect(result.coveragePct).toBeLessThan(70);
    expect(result.isClean).toBe(false);
  });

  it("ignores low-confidence samples and low-confidence target notes", () => {
    const uncertainNote = note({ start: 0, end: 1, midi: 69, confidence: 0.2 });
    const lowConfidenceSamples: ExerciseAttemptSample[] = Array.from({ length: 10 }, (_, i) => ({
      t: i * 0.05,
      frequencyHz: centsToFrequency(69, 0),
      confidence: 0.1,
    }));
    const result = evaluateExerciseAttempt(lowConfidenceSamples, [uncertainNote]);
    expect(result.hasEnoughSignal).toBe(false);
  });
});
