import { describe, expect, it } from "vitest";
import {
  centsOffFromMidi,
  hzToMidi,
  midiToHz,
  midiToNoteName,
  noteNameToMidi,
  transposeMelodyNotes,
  transposePitchClass,
} from "../music";
import type { MelodyNoteDTO } from "../types";

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

describe("transposePitchClass", () => {
  it("shifts naturals and wraps within the octave", () => {
    expect(transposePitchClass("C", 1)).toBe("C#");
    expect(transposePitchClass("C", -1)).toBe("B");
    expect(transposePitchClass("B", 1)).toBe("C");
  });

  it("shifts sharps and flats correctly", () => {
    expect(transposePitchClass("F#", 2)).toBe("G#");
    expect(transposePitchClass("Bb", -2)).toBe("G#");
  });

  it("a zero shift is a no-op", () => {
    expect(transposePitchClass("E", 0)).toBe("E");
  });

  it("throws on an invalid pitch class", () => {
    expect(() => transposePitchClass("H", 1)).toThrow();
    expect(() => transposePitchClass("C4", 1)).toThrow(); // octave-qualified names aren't a bare pitch class
  });
});

describe("transposeMelodyNotes", () => {
  const notes: MelodyNoteDTO[] = [
    { id: "n1", start: 0, end: 1, midi: 69, noteName: "A4", confidence: 0.9, meanFrequencyHz: midiToHz(69) },
    { id: "n2", start: 1, end: 2, midi: 72, noteName: "C5", confidence: 0.8, meanFrequencyHz: midiToHz(72) },
  ];

  it("shifts midi, noteName, and meanFrequencyHz together and consistently", () => {
    const shifted = transposeMelodyNotes(notes, -2);
    expect(shifted[0].midi).toBe(67);
    expect(shifted[0].noteName).toBe("G4");
    expect(shifted[0].meanFrequencyHz).toBeCloseTo(midiToHz(67), 6);
    expect(shifted[1].midi).toBe(70);
    expect(shifted[1].noteName).toBe("A#4");
  });

  it("leaves start/end/confidence untouched", () => {
    const shifted = transposeMelodyNotes(notes, 3);
    expect(shifted[0].start).toBe(notes[0].start);
    expect(shifted[0].end).toBe(notes[0].end);
    expect(shifted[0].confidence).toBe(notes[0].confidence);
  });

  it("returns the same array reference for a zero shift", () => {
    expect(transposeMelodyNotes(notes, 0)).toBe(notes);
  });
});
