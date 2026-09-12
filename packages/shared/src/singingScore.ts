/**
 * Turns a stream of live microphone pitch samples into a short list of
 * specific, encouraging, technical sentences - never a single unexplained
 * score (see command.txt "SINGING SCORE": "Do NOT reduce everything to an
 * unexplained score" / "Keep feedback encouraging and technical").
 *
 * Deliberately averages over whole notes/phrases rather than judging every
 * individual frame: normal vibrato oscillates roughly symmetrically around
 * the target pitch, so it washes out in a mean rather than being flagged as
 * an error the way a naive frame-by-frame threshold would.
 */

import { centsOffFromMidi } from "./music";
import type { LyricLineDTO, MelodyNoteDTO } from "./types";

export interface PitchSample {
  /** Canonical playback time (seconds) this sample was captured at. */
  t: number;
  /** Observed fundamental frequency, or null for silence/unvoiced. */
  frequencyHz: number | null;
  /** 0..1 detector confidence for this sample (see pitchDetection.ts). */
  confidence: number;
}

export type SingingInsightKind = "pitch_tendency" | "note_deviation" | "timing_onset" | "note_coverage" | "encouragement";

export interface SingingInsight {
  kind: SingingInsightKind;
  text: string;
}

export interface SingingFeedbackOptions {
  /** Ignore observed samples below this detector confidence. */
  minSampleConfidence?: number;
  /** Ignore target notes below this pipeline confidence - never compare against an uncertain target. */
  minNoteConfidence?: number;
  /** Minimum |mean deviation| (cents) worth calling out; smaller than this reads as "in tune". */
  deviationThresholdCents?: number;
  /** Minimum |onset delay| (ms) worth calling out; smaller than this is imperceptible. */
  timingThresholdMs?: number;
  /** Minimum matched samples for a single note before its deviation is trusted enough to report. */
  minSamplesPerNote?: number;
}

const DEFAULTS: Required<SingingFeedbackOptions> = {
  minSampleConfidence: 0.5,
  minNoteConfidence: 0.5,
  deviationThresholdCents: 15,
  timingThresholdMs: 120,
  minSamplesPerNote: 3,
};

function formatMmSs(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface MatchedSample {
  cents: number;
  note: MelodyNoteDTO;
}

function matchSamplesToNotes(
  samples: PitchSample[],
  notes: MelodyNoteDTO[],
  opts: Required<SingingFeedbackOptions>
): MatchedSample[] {
  const confidentNotes = notes.filter((n) => n.confidence >= opts.minNoteConfidence);
  const matched: MatchedSample[] = [];
  for (const sample of samples) {
    if (sample.frequencyHz === null || sample.confidence < opts.minSampleConfidence) continue;
    const note = confidentNotes.find((n) => sample.t >= n.start && sample.t < n.end);
    if (!note) continue;
    matched.push({ cents: centsOffFromMidi(sample.frequencyHz, note.midi), note });
  }
  return matched;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Builds the list of feedback sentences for one practice session (typically
 * one loop of a line or section). Returns an empty-data encouragement
 * rather than an empty array when there isn't enough signal to say
 * anything specific yet.
 */
export function buildSingingFeedback(
  samples: PitchSample[],
  notes: MelodyNoteDTO[],
  lines: LyricLineDTO[],
  options: SingingFeedbackOptions = {}
): SingingInsight[] {
  const opts = { ...DEFAULTS, ...options };
  const insights: SingingInsight[] = [];

  const matched = matchSamplesToNotes(samples, notes, opts);

  if (matched.length === 0) {
    insights.push({
      kind: "encouragement",
      text: "Sing along while a target note is visible in the pitch guide to get feedback on this phrase.",
    });
    return insights;
  }

  // Overall tendency: a systematic bias, not frame-by-frame noise/vibrato.
  const overallMeanCents = mean(matched.map((m) => m.cents));
  if (Math.abs(overallMeanCents) >= opts.deviationThresholdCents) {
    const direction = overallMeanCents < 0 ? "flat" : "sharp";
    insights.push({
      kind: "pitch_tendency",
      text: `You tend to sing this phrase about ${Math.round(Math.abs(overallMeanCents))} cents ${direction} overall.`,
    });
  } else {
    const meanAbsCents = mean(matched.map((m) => Math.abs(m.cents)));
    insights.push({
      kind: "pitch_tendency",
      text: `Your pitch is close to the target on this phrase (within ${Math.round(meanAbsCents)} cents on average).`,
    });
  }

  // Per-note deviation: call out the single worst note that's consistently
  // (not just noisily) off, so this doesn't fire for ordinary vibrato.
  const byNote = new Map<string, MatchedSample[]>();
  for (const m of matched) {
    const list = byNote.get(m.note.id) ?? [];
    list.push(m);
    byNote.set(m.note.id, list);
  }
  let worstNote: { note: MelodyNoteDTO; meanCents: number } | null = null;
  for (const [, list] of byNote) {
    if (list.length < opts.minSamplesPerNote) continue;
    const meanCents = mean(list.map((m) => m.cents));
    const sameSignFraction = list.filter((m) => Math.sign(m.cents) === Math.sign(meanCents)).length / list.length;
    if (Math.abs(meanCents) < opts.deviationThresholdCents || sameSignFraction < 0.7) continue;
    if (!worstNote || Math.abs(meanCents) > Math.abs(worstNote.meanCents)) {
      worstNote = { note: list[0].note, meanCents };
    }
  }
  if (worstNote) {
    const direction = worstNote.meanCents < 0 ? "below" : "above";
    insights.push({
      kind: "note_deviation",
      text: `The note at ${formatMmSs(worstNote.note.start)} (${worstNote.note.noteName}) is consistently sung ${direction} the target by about ${Math.round(Math.abs(worstNote.meanCents))} cents.`,
    });
  }

  // Timing: how late/early the user's first voiced sample is relative to
  // each line's start; report only the most noticeable offender.
  let worstTiming: { line: LyricLineDTO; delayMs: number } | null = null;
  for (const line of lines) {
    const firstInLine = samples
      .filter((s) => s.frequencyHz !== null && s.confidence >= opts.minSampleConfidence)
      .filter((s) => s.t >= line.start - 1 && s.t < line.end)
      .sort((a, b) => a.t - b.t)[0];
    if (!firstInLine) continue;
    const delayMs = (firstInLine.t - line.start) * 1000;
    if (Math.abs(delayMs) < opts.timingThresholdMs) continue;
    if (!worstTiming || Math.abs(delayMs) > Math.abs(worstTiming.delayMs)) {
      worstTiming = { line, delayMs };
    }
  }
  if (worstTiming) {
    const direction = worstTiming.delayMs > 0 ? "late" : "early";
    insights.push({
      kind: "timing_onset",
      text: `You enter the phrase at ${formatMmSs(worstTiming.line.start)} approximately ${Math.round(Math.abs(worstTiming.delayMs))}ms ${direction}.`,
    });
  }

  // Note coverage: of the confident target notes in view, how much of
  // their combined duration did the user actually voice something during
  // (regardless of accuracy) - flags "not attempting the note" separately
  // from "attempting it slightly out of tune".
  const confidentNotes = notes.filter((n) => n.confidence >= opts.minNoteConfidence);
  const totalNoteDuration = confidentNotes.reduce((sum, n) => sum + (n.end - n.start), 0);
  if (totalNoteDuration > 0) {
    const voicedTimestamps = samples
      .filter((s) => s.frequencyHz !== null && s.confidence >= opts.minSampleConfidence)
      .map((s) => s.t);
    let coveredDuration = 0;
    for (const note of confidentNotes) {
      const hasVoicedSample = voicedTimestamps.some((t) => t >= note.start && t < note.end);
      if (hasVoicedSample) coveredDuration += note.end - note.start;
    }
    const coveragePct = Math.round((coveredDuration / totalNoteDuration) * 100);
    if (coveragePct < 80) {
      insights.push({
        kind: "note_coverage",
        text: `You sang through about ${coveragePct}% of the target notes in this phrase - try coming in on the rest too.`,
      });
    }
  }

  return insights;
}
