/**
 * Turns one exercise attempt (a single loop through a passage flagged by
 * DIFFICULT PARTS) into a simple pass/fail "clean attempt" verdict, for the
 * FUTURE FEATURES item "vocal exercises based on difficult notes". This is
 * deliberately independent of singingScore.ts's feedback sentences - the
 * exercise flow only needs a yes/no "did that attempt clear the bar" signal
 * to advance a mastery counter, not a full technical explanation each time
 * (the user already sees that explanation in the regular mic practice
 * panel if they want it).
 */

import { centsOffFromMidi } from "./music";
import type { MelodyNoteDTO } from "./types";

export interface ExerciseAttemptSample {
  t: number;
  frequencyHz: number | null;
  confidence: number;
}

export interface ExerciseAttemptResult {
  /** False when there wasn't enough signal to judge the attempt at all - not the same as "not clean". */
  hasEnoughSignal: boolean;
  meanAbsCentsOff: number | null;
  coveragePct: number | null;
  isClean: boolean;
}

const MIN_SAMPLE_CONFIDENCE = 0.5;
const MIN_NOTE_CONFIDENCE = 0.5;
const MIN_MATCHED_SAMPLES = 5;
// Deliberately more forgiving than singingScore.ts's 15-cent "call this out"
// threshold - this just gates whether to advance the mastery counter, not
// whether to mention a deviation at all.
const CLEAN_MAX_MEAN_ABS_CENTS = 35;
const CLEAN_MIN_COVERAGE_PCT = 70;

export function evaluateExerciseAttempt(
  samples: ExerciseAttemptSample[],
  notes: MelodyNoteDTO[]
): ExerciseAttemptResult {
  const confidentNotes = notes.filter((n) => n.confidence >= MIN_NOTE_CONFIDENCE);
  const matchedCents: number[] = [];
  const voicedTimestamps: number[] = [];

  for (const sample of samples) {
    if (sample.frequencyHz === null || sample.confidence < MIN_SAMPLE_CONFIDENCE) continue;
    voicedTimestamps.push(sample.t);
    const note = confidentNotes.find((n) => sample.t >= n.start && sample.t < n.end);
    if (note) matchedCents.push(centsOffFromMidi(sample.frequencyHz, note.midi));
  }

  const totalNoteDuration = confidentNotes.reduce((sum, n) => sum + (n.end - n.start), 0);
  let coveragePct: number | null = null;
  if (totalNoteDuration > 0) {
    let coveredDuration = 0;
    for (const note of confidentNotes) {
      if (voicedTimestamps.some((t) => t >= note.start && t < note.end)) coveredDuration += note.end - note.start;
    }
    coveragePct = (coveredDuration / totalNoteDuration) * 100;
  }

  if (matchedCents.length < MIN_MATCHED_SAMPLES || coveragePct === null) {
    return { hasEnoughSignal: false, meanAbsCentsOff: null, coveragePct, isClean: false };
  }

  const meanAbsCentsOff = matchedCents.reduce((sum, c) => sum + Math.abs(c), 0) / matchedCents.length;
  const isClean = meanAbsCentsOff <= CLEAN_MAX_MEAN_ABS_CENTS && coveragePct >= CLEAN_MIN_COVERAGE_PCT;

  return { hasEnoughSignal: true, meanAbsCentsOff, coveragePct, isClean };
}
