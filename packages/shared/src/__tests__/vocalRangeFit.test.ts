import { describe, expect, it } from "vitest";
import { midiToHz } from "../music";
import { estimateHeldNoteMidi, evaluateVocalRangeFit } from "../vocalRangeFit";

describe("evaluateVocalRangeFit", () => {
  it("reports a fit with no transpose needed when the song already sits inside the user's range", () => {
    const result = evaluateVocalRangeFit({ lowestMidi: 60, highestMidi: 72 }, { lowestMidi: 55, highestMidi: 79 });
    expect(result).toEqual({ fit: "fits", suggestedTransposeSemitones: 0 });
  });

  it("suggests shifting down when only the song's high end is out of range", () => {
    // Song tops out 2 semitones above the user's highest comfortable note.
    const result = evaluateVocalRangeFit({ lowestMidi: 60, highestMidi: 81 }, { lowestMidi: 55, highestMidi: 79 });
    expect(result.fit).toBe("fits_with_transpose");
    expect(result.suggestedTransposeSemitones).toBe(-2);
  });

  it("suggests shifting up when only the song's low end is out of range", () => {
    const result = evaluateVocalRangeFit({ lowestMidi: 53, highestMidi: 70 }, { lowestMidi: 55, highestMidi: 79 });
    expect(result.fit).toBe("fits_with_transpose");
    expect(result.suggestedTransposeSemitones).toBe(2);
  });

  it("reports still out of range when the song's span is wider than the user's, even at the best shift", () => {
    // Song spans 30 semitones, user's comfortable range only spans 12.
    const result = evaluateVocalRangeFit({ lowestMidi: 50, highestMidi: 80 }, { lowestMidi: 60, highestMidi: 72 });
    expect(result.fit).toBe("still_out_of_range");
  });

  it("clamps the suggestion to the supported transpose range and still reports out of range if that isn't enough", () => {
    // Needs a 5-semitone shift down, but the default max is +-3.
    const result = evaluateVocalRangeFit({ lowestMidi: 60, highestMidi: 84 }, { lowestMidi: 55, highestMidi: 79 });
    expect(result.fit).toBe("still_out_of_range");
    expect(result.suggestedTransposeSemitones).toBe(-3);
  });

  it("respects custom transpose bounds", () => {
    const result = evaluateVocalRangeFit(
      { lowestMidi: 60, highestMidi: 84 },
      { lowestMidi: 55, highestMidi: 79 },
      { minTransposeSemitones: -6, maxTransposeSemitones: 6 }
    );
    expect(result).toEqual({ fit: "fits_with_transpose", suggestedTransposeSemitones: -5 });
  });
});

describe("estimateHeldNoteMidi", () => {
  it("returns the held note's rounded MIDI value from a clean, confident burst", () => {
    const samples = Array.from({ length: 10 }, () => ({ frequencyHz: 440, confidence: 0.9 }));
    expect(estimateHeldNoteMidi(samples)).toBe(69);
  });

  it("ignores low-confidence and unvoiced samples", () => {
    const samples = [
      ...Array.from({ length: 8 }, () => ({ frequencyHz: 440, confidence: 0.9 })),
      ...Array.from({ length: 8 }, () => ({ frequencyHz: 220, confidence: 0.1 })), // low confidence: ignored
      ...Array.from({ length: 8 }, () => ({ frequencyHz: null, confidence: 0 })), // unvoiced: ignored
    ];
    expect(estimateHeldNoteMidi(samples)).toBe(69);
  });

  it("returns null when there aren't enough confident samples", () => {
    const samples = Array.from({ length: 3 }, () => ({ frequencyHz: 440, confidence: 0.9 }));
    expect(estimateHeldNoteMidi(samples)).toBeNull();
  });

  it("picks the mode over the mean, so a brief vibrato overshoot doesn't shift the result", () => {
    const samples = [
      ...Array.from({ length: 8 }, () => ({ frequencyHz: midiToHz(69), confidence: 0.9 })),
      ...Array.from({ length: 2 }, () => ({ frequencyHz: midiToHz(70), confidence: 0.9 })),
    ];
    expect(estimateHeldNoteMidi(samples)).toBe(69);
  });
});
