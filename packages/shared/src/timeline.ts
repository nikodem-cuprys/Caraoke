import type { LyricLineDTO, LyricWordDTO, PitchPointDTO, SongSectionDTO } from "./types";
import { clamp } from "./music";

export const PLAYBACK_SPEEDS = [0.5, 0.75, 0.9, 1.0] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

export function isValidPlaybackSpeed(speed: number): speed is PlaybackSpeed {
  return (PLAYBACK_SPEEDS as readonly number[]).includes(speed);
}

/** Find the lyric line active at time t (seconds), or null if between/outside lines. */
export function findActiveLine(lines: LyricLineDTO[], t: number): LyricLineDTO | null {
  for (const line of lines) {
    if (t >= line.start && t < line.end) return line;
  }
  return null;
}

/** Find the next line starting strictly after time t, if any. */
export function findNextLine(lines: LyricLineDTO[], t: number): LyricLineDTO | null {
  let best: LyricLineDTO | null = null;
  for (const line of lines) {
    if (line.start > t && (best === null || line.start < best.start)) best = line;
  }
  return best;
}

/** Find the previous line (the one whose start is <= t and is not the active/next line). */
export function findPreviousLine(lines: LyricLineDTO[], t: number): LyricLineDTO | null {
  const sorted = [...lines].sort((a, b) => a.start - b.start);
  let prev: LyricLineDTO | null = null;
  for (const line of sorted) {
    if (line.start < t) prev = line;
    else break;
  }
  return prev;
}

/** Word highlighting: returns the word active at time t within a line, or null. */
export function findActiveWord(words: LyricWordDTO[], t: number): LyricWordDTO | null {
  for (const word of words) {
    if (t >= word.start && t < word.end) return word;
  }
  return null;
}

export function findActiveSection(sections: SongSectionDTO[], t: number): SongSectionDTO | null {
  for (const section of sections) {
    if (t >= section.start && t < section.end) return section;
  }
  return null;
}

/** Find the next section starting strictly after time t, if any. */
export function findNextSection(sections: SongSectionDTO[], t: number): SongSectionDTO | null {
  let best: SongSectionDTO | null = null;
  for (const section of sections) {
    if (section.start > t && (best === null || section.start < best.start)) best = section;
  }
  return best;
}

/** Find the previous section (the one whose start is <= t and is not the active/next section). */
export function findPreviousSection(sections: SongSectionDTO[], t: number): SongSectionDTO | null {
  const sorted = [...sections].sort((a, b) => a.start - b.start);
  let prev: SongSectionDTO | null = null;
  for (const section of sorted) {
    if (section.start < t) prev = section;
    else break;
  }
  return prev;
}

export interface LoopRegion {
  start: number;
  end: number;
}

/**
 * Compute the effective loop window for a lyric line, applying a pre-roll
 * (seconds to start before the line) clamped so it never goes negative or
 * crosses into the previous line's region, and never exceeds song duration.
 */
export function computeLineLoopRegion(
  line: LyricLineDTO,
  prerollSec: number,
  songDurationSec: number,
  previousLineEnd = 0
): LoopRegion {
  const start = clamp(line.start - prerollSec, previousLineEnd, line.start);
  const end = clamp(line.end, start, songDurationSec);
  return { start, end };
}

export function computeSectionLoopRegion(
  section: SongSectionDTO,
  prerollSec: number,
  songDurationSec: number
): LoopRegion {
  const start = clamp(section.start - prerollSec, 0, section.start);
  const end = clamp(section.end, start, songDurationSec);
  return { start, end };
}

/**
 * Given current playback time and a loop region, return the time to seek to
 * once playback reaches/exceeds the loop end. Returns null if not yet at the
 * loop boundary.
 */
export function nextLoopSeekTime(currentTime: number, region: LoopRegion): number | null {
  if (currentTime >= region.end) return region.start;
  return null;
}

/**
 * Convert a desired wall-clock seek offset at the *displayed* (possibly
 * slowed-down) rate into the underlying media time — with HTMLMediaElement
 * currentTime this is a no-op because currentTime is always expressed in
 * media time regardless of playbackRate, but rewinding by a fixed number of
 * *perceived* seconds should still just subtract media seconds, so this
 * helper exists to keep that assumption explicit and tested.
 */
export function rewindBySeconds(currentTime: number, seconds: number, min = 0): number {
  return clamp(currentTime - seconds, min, Number.POSITIVE_INFINITY);
}

/** Downsample an ordered array of pitch points to at most maxPoints using stride decimation. */
export function downsamplePitchPoints(points: PitchPointDTO[], maxPoints: number): PitchPointDTO[] {
  if (maxPoints <= 0) throw new RangeError("maxPoints must be positive");
  if (points.length <= maxPoints) return points;
  const stride = points.length / maxPoints;
  const result: PitchPointDTO[] = [];
  for (let i = 0; i < maxPoints; i++) {
    result.push(points[Math.min(points.length - 1, Math.floor(i * stride))]);
  }
  return result;
}

/**
 * Map a UI-selected playback speed to the value passed to
 * HTMLMediaElement.playbackRate. Browsers apply pitch-preserving time
 * stretching to `playbackRate` by default (preservesPitch defaults to true),
 * so no separate pitch-shifting step is required for this control.
 */
export function speedToPlaybackRate(speed: PlaybackSpeed): number {
  return speed;
}
