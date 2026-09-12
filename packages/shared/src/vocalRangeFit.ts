/**
 * Compares a song's detected vocal range against the user's own (measured
 * via a short microphone calibration - see
 * apps/web/src/components/VocalRangeCard.tsx) to answer command.txt's
 * stated purpose for vocal range detection directly: "This helps the user
 * understand whether the song fits their range" - previously the feature
 * only displayed the song's range as numbers, with no actual fit check
 * against anything.
 */

import { MAX_TRANSPOSE_SEMITONES, MIN_TRANSPOSE_SEMITONES, hzToMidi } from "./music";

export interface MidiRange {
  lowestMidi: number;
  highestMidi: number;
}

export type VocalRangeFit = "fits" | "fits_with_transpose" | "still_out_of_range";

export interface VocalRangeFitResult {
  fit: VocalRangeFit;
  /** Best shift within the supported transpose range (see TransposeControl); 0 when the song already fits with no shift. */
  suggestedTransposeSemitones: number;
}

/**
 * Finds the best transpose shift (within the app's supported -3..+3 range
 * by default) to fit the song's vocal range inside the user's. Prefers the
 * smallest-magnitude shift that fully fits; if none fits fully, prefers
 * whichever shift minimizes how far out of range the song still is.
 */
export function evaluateVocalRangeFit(
  songRange: MidiRange,
  userRange: MidiRange,
  options: { minTransposeSemitones?: number; maxTransposeSemitones?: number } = {}
): VocalRangeFitResult {
  const minT = options.minTransposeSemitones ?? MIN_TRANSPOSE_SEMITONES;
  const maxT = options.maxTransposeSemitones ?? MAX_TRANSPOSE_SEMITONES;

  const overflowAt = (shift: number): number => {
    const lowOverflow = Math.max(0, userRange.lowestMidi - (songRange.lowestMidi + shift));
    const highOverflow = Math.max(0, songRange.highestMidi + shift - userRange.highestMidi);
    return lowOverflow + highOverflow;
  };

  if (overflowAt(0) === 0) {
    return { fit: "fits", suggestedTransposeSemitones: 0 };
  }

  let best = { shift: 0, overflow: overflowAt(0) };
  for (let shift = minT; shift <= maxT; shift++) {
    const overflow = overflowAt(shift);
    if (overflow < best.overflow || (overflow === best.overflow && Math.abs(shift) < Math.abs(best.shift))) {
      best = { shift, overflow };
    }
  }

  return {
    fit: best.overflow === 0 ? "fits_with_transpose" : "still_out_of_range",
    suggestedTransposeSemitones: best.shift,
  };
}

/**
 * Summarizes a burst of live pitch samples (captured while the user holds
 * one steady note during range calibration) into a single rounded MIDI
 * value - the mode of confident samples' rounded semitone, which is more
 * robust to vibrato than a mean (a mean can land between two real notes;
 * the mode picks whichever note was actually held longest). Returns null
 * when there weren't enough confident samples to trust the result, rather
 * than guessing from a thin signal.
 */
export function estimateHeldNoteMidi(
  samples: { frequencyHz: number | null; confidence: number }[],
  minConfidence = 0.5,
  minSamples = 5
): number | null {
  const confidentMidis = samples
    .filter((s) => s.frequencyHz !== null && s.confidence >= minConfidence)
    .map((s) => Math.round(hzToMidi(s.frequencyHz as number)));

  if (confidentMidis.length < minSamples) return null;

  const counts = new Map<number, number>();
  for (const midi of confidentMidis) counts.set(midi, (counts.get(midi) ?? 0) + 1);

  let bestMidi = confidentMidis[0];
  let bestCount = 0;
  for (const [midi, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      bestMidi = midi;
    }
  }
  return bestMidi;
}
