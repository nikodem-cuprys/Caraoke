/**
 * Overall song difficulty rating (command.txt FUTURE FEATURES: "song
 * difficulty"), estimated entirely from data the pipeline already produces
 * - no new worker analysis, no schema change. Deliberately requires a
 * confident vocal range (the primary driver of vocal difficulty) and
 * returns null rather than guessing when one isn't available, extending
 * the per-passage DIFFICULT PARTS section's "do not claim difficulty with
 * certainty" principle to the whole-song rating.
 */

import { clamp } from "./music";
import type { DifficultPartDTO, LyricLineDTO, VocalRangeDTO } from "./types";

export type DifficultyLevel = "easy" | "moderate" | "challenging" | "difficult";

export interface DifficultyEstimate {
  level: DifficultyLevel;
  /** Plain-language factors behind the level - same "explain the estimate, don't just show a number" spirit as singingScore.ts's feedback sentences. */
  factors: string[];
}

// Vocal demands (range) matter most for singing difficulty; passage-level
// trouble spots and lyric speed are secondary but real contributors.
const VOCAL_RANGE_WEIGHT = 0.4;
const DIFFICULT_PARTS_WEIGHT = 0.35;
const LYRIC_DENSITY_WEIGHT = 0.25;

// A two-octave-plus range, several severe difficult passages, or
// rap-speed lyrics (~4 words/sec) each independently max out their own
// sub-score; these aren't hard science, just reasonable normalizing
// ceilings for turning raw numbers into a comparable 0..1 scale.
const WIDE_RANGE_SEMITONES = 30;
const HIGH_DIFFICULT_PART_SEVERITY_SUM = 5;
const FAST_LYRICS_WORDS_PER_SEC = 4;

export function estimateSongDifficulty(song: {
  vocalRange: VocalRangeDTO | null;
  difficultParts: DifficultPartDTO[];
  lines: LyricLineDTO[];
  durationSec: number;
}): DifficultyEstimate | null {
  if (!song.vocalRange || song.durationSec <= 0) return null;

  const vocalRangeScore = clamp(song.vocalRange.semitoneRange / WIDE_RANGE_SEMITONES, 0, 1);

  const difficultPartsSeverity = song.difficultParts.reduce((sum, p) => sum + p.severity, 0);
  const difficultPartsScore = clamp(difficultPartsSeverity / HIGH_DIFFICULT_PART_SEVERITY_SUM, 0, 1);

  const totalWords = song.lines.reduce((sum, line) => sum + line.words.length, 0);
  const wordsPerSecond = totalWords / song.durationSec;
  const lyricDensityScore = clamp(wordsPerSecond / FAST_LYRICS_WORDS_PER_SEC, 0, 1);

  const score =
    vocalRangeScore * VOCAL_RANGE_WEIGHT +
    difficultPartsScore * DIFFICULT_PARTS_WEIGHT +
    lyricDensityScore * LYRIC_DENSITY_WEIGHT;

  let level: DifficultyLevel;
  if (score < 0.25) level = "easy";
  else if (score < 0.5) level = "moderate";
  else if (score < 0.75) level = "challenging";
  else level = "difficult";

  const factors: string[] = [
    `Vocal range: ${song.vocalRange.semitoneRange} semitones (${song.vocalRange.lowestNote}–${song.vocalRange.highestNote})`,
  ];
  if (song.difficultParts.length > 0) {
    factors.push(
      `${song.difficultParts.length} difficult passage${song.difficultParts.length === 1 ? "" : "s"} detected`
    );
  }
  if (totalWords > 0) {
    factors.push(`Lyrics: ${wordsPerSecond.toFixed(1)} words/sec average`);
  }

  return { level, factors };
}
