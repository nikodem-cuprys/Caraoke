import { describe, expect, it } from "vitest";
import { centsOffFromMidi, hzToMidi, midiToHz, midiToNoteName, noteNameToMidi } from "../music";

describe("hzToMidi", () => {
  it("maps A4 (440Hz) to MIDI 69", () => {
    expect(hzToMidi(440)).toBeCloseTo(69, 6);
  });

  it("maps A3 (220Hz) to MIDI 57", () => {
    expect(hzToMidi(220)).toBeCloseTo(57, 6);
  });

  it("maps C5 (~523.25Hz) to MIDI 72", () => {
    expect(hzToMidi(523.2511)).toBeCloseTo(72, 2);
  });

  it("throws on non-positive frequency", () => {
    expect(() => hzToMidi(0)).toThrow();
    expect(() => hzToMidi(-10)).toThrow();
  });
});

describe("midiToHz", () => {
  it("is the inverse of hzToMidi", () => {
    for (const hz of [110, 261.63, 440, 880]) {
      expect(midiToHz(hzToMidi(hz))).toBeCloseTo(hz, 3);
    }
  });
});

describe("midiToNoteName", () => {
  it.each([
    [69, "A4"],
    [60, "C4"],
    [61, "C#4"],
    [72, "C5"],
    [57, "A3"],
    [0, "C-1"],
  ])("midi %i -> %s", (midi, expected) => {
    expect(midiToNoteName(midi)).toBe(expected);
  });

  it("rounds fractional midi to nearest semitone", () => {
    expect(midiToNoteName(69.4)).toBe("A4");
    expect(midiToNoteName(69.6)).toBe("A#4");
  });
});

describe("noteNameToMidi", () => {
  it("round-trips with midiToNoteName for natural and sharp notes", () => {
    for (const midi of [40, 45, 57, 60, 61, 69, 72, 84]) {
      expect(noteNameToMidi(midiToNoteName(midi))).toBe(midi);
    }
  });

  it("accepts flats", () => {
    expect(noteNameToMidi("Bb3")).toBe(noteNameToMidi("A#3"));
  });

  it("throws on garbage input", () => {
    expect(() => noteNameToMidi("nope")).toThrow();
  });
});

describe("centsOffFromMidi", () => {
  it("is 0 cents when exactly on pitch", () => {
    expect(centsOffFromMidi(440, 69)).toBeCloseTo(0, 3);
  });

  it("is positive when sharp, negative when flat", () => {
    // one semitone sharp of A4 target (still target midi 69)
    expect(centsOffFromMidi(midiToHz(70), 69)).toBeCloseTo(100, 3);
    expect(centsOffFromMidi(midiToHz(68), 69)).toBeCloseTo(-100, 3);
  });
});
