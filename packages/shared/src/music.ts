/** Pure music-theory helpers shared by the API, web app, and tests. */

import type { MelodyNoteDTO } from "./types";

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** Convert a frequency in Hz to a (possibly fractional) MIDI note number. A4 = 440Hz = MIDI 69. */
export function hzToMidi(frequencyHz: number): number {
  if (!(frequencyHz > 0)) {
    throw new RangeError(`hzToMidi requires a positive frequency, got ${frequencyHz}`);
  }
  return 69 + 12 * Math.log2(frequencyHz / 440);
}

/** Convert a MIDI note number (can be fractional) back to Hz. */
export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Convert a MIDI note number to a note name such as "C#4". Rounds to nearest semitone. */
export function midiToNoteName(midi: number): string {
  const rounded = Math.round(midi);
  const noteIndex = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

/** Parse a note name such as "C#4" or "Bb3" back into a MIDI note number. */
export function noteNameToMidi(noteName: string): number {
  const match = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(noteName.trim());
  if (!match) {
    throw new RangeError(`Invalid note name: ${noteName}`);
  }
  const [, letter, accidental, octaveStr] = match;
  const baseIndex = NOTE_NAMES.findIndex((n) => n[0] === letter.toUpperCase());
  let semitone = baseIndex;
  if (accidental === "#") semitone += 1;
  if (accidental === "b") semitone -= 1;
  const octave = parseInt(octaveStr, 10);
  return (octave + 1) * 12 + semitone;
}

/** Signed cents difference between an observed frequency and a target MIDI note. */
export function centsOffFromMidi(frequencyHz: number, targetMidi: number): number {
  const observedMidi = hzToMidi(frequencyHz);
  return (observedMidi - targetMidi) * 100;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Practice/pitch-guide transpose range, per command.txt's "SPECIAL FEATURE — KEY / TRANSPOSITION" spec. */
export const MIN_TRANSPOSE_SEMITONES = -3;
export const MAX_TRANSPOSE_SEMITONES = 3;

/**
 * Shifts a bare pitch class (no octave, e.g. "E", "F#", "Bb") by N
 * semitones, wrapping within the octave. Used for showing a transposed key
 * (KeyEstimateDTO.tonic has no absolute octave to carry a shift on the way
 * a MelodyNoteDTO's midi number does).
 */
export function transposePitchClass(pitchClass: string, semitones: number): string {
  const match = /^([A-Ga-g])([#b]?)$/.exec(pitchClass.trim());
  if (!match) {
    throw new RangeError(`Invalid pitch class: ${pitchClass}`);
  }
  const [, letter, accidental] = match;
  const baseIndex = NOTE_NAMES.findIndex((n) => n[0] === letter.toUpperCase());
  let semitone = baseIndex;
  if (accidental === "#") semitone += 1;
  if (accidental === "b") semitone -= 1;
  const shifted = (((semitone + semitones) % 12) + 12) % 12;
  return NOTE_NAMES[shifted];
}

/**
 * Shifts a melody's target notes by N semitones for the transpose/key-shift
 * practice feature. This only changes what's displayed and what the live
 * microphone comparison judges the user against - it does not touch (and
 * cannot, without re-processing) the actual backing audio's pitch, which
 * keeps playing in the original key. Returns the input unchanged (same
 * array reference) for a zero shift, so callers can use it unconditionally
 * without an extra branch.
 */
export function transposeMelodyNotes(notes: MelodyNoteDTO[], semitones: number): MelodyNoteDTO[] {
  if (semitones === 0) return notes;
  return notes.map((n) => {
    const midi = n.midi + semitones;
    return { ...n, midi, noteName: midiToNoteName(midi), meanFrequencyHz: midiToHz(midi) };
  });
}
