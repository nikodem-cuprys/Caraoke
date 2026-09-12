/**
 * Spaced repetition for practiced songs (command.txt FUTURE FEATURES:
 * "spaced repetition for lyrics"). Scoped per-song rather than per-line:
 * the pipeline doesn't track per-line practice history (PracticeSession is
 * a whole-song row - see README's "Difficulty rating & practice history"),
 * and per-line scheduling would need new schema and UI just to decide
 * *when* to nudge someone, which the FUTURE FEATURES list's one-line
 * mention doesn't warrant on its own. A whole-song "you're due to review
 * this one again" schedule reuses PracticeSummaryDTO's existing
 * sessionCount/lastPracticedAt - no new data collection needed.
 *
 * Uses a simple, widely-recognized increasing-interval schedule (the same
 * shape as a basic Leitner system) rather than a full SM-2 implementation
 * with per-song ease factors: there's no "how well did you recall it"
 * input to calibrate an ease factor from (this is singing practice, not a
 * flashcard grade), so a fixed schedule keyed only by how many times
 * you've practiced is the honest amount of sophistication for the signal
 * actually available.
 */

const REVIEW_INTERVALS_DAYS = [1, 3, 7, 14, 30, 60];
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReviewSchedule {
  /** ISO timestamp of the next suggested review, or null if the song has never been practiced (there's nothing to schedule yet). */
  dueAt: string | null;
  isDue: boolean;
  /** The interval (days) after the last session that produced dueAt; null alongside dueAt. */
  intervalDays: number | null;
}

export function computeReviewSchedule(
  sessionCount: number,
  lastPracticedAt: string | null,
  now: Date = new Date()
): ReviewSchedule {
  if (sessionCount <= 0 || !lastPracticedAt) {
    return { dueAt: null, isDue: false, intervalDays: null };
  }
  const intervalIndex = Math.min(sessionCount - 1, REVIEW_INTERVALS_DAYS.length - 1);
  const intervalDays = REVIEW_INTERVALS_DAYS[intervalIndex];
  const dueAtMs = new Date(lastPracticedAt).getTime() + intervalDays * DAY_MS;
  return { dueAt: new Date(dueAtMs).toISOString(), isDue: dueAtMs <= now.getTime(), intervalDays };
}
