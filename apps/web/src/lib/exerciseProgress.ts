const STORAGE_KEY = "singlearn_exercise_progress";

// Number of clean attempts (see evaluateExerciseAttempt) needed before a
// difficult passage is considered mastered. Cumulative, not a streak: one
// rough attempt after two clean ones doesn't erase the earlier progress -
// the goal is "have you nailed this enough times," not "did you just nail
// it in a row."
export const MASTERY_THRESHOLD = 3;

interface ProgressStore {
  [songId: string]: {
    [partId: string]: { cleanPassCount: number; lastPracticedAt: string };
  };
}

function readStore(): ProgressStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeStore(store: ProgressStore): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Best-effort only - a user in private browsing or with storage
    // disabled just loses their exercise progress across visits.
  }
}

export function getExerciseCleanPassCount(songId: string, partId: string): number {
  return readStore()[songId]?.[partId]?.cleanPassCount ?? 0;
}

/** Records one attempt's outcome and returns the updated clean-pass count. */
export function recordExerciseAttempt(songId: string, partId: string, isClean: boolean): number {
  const store = readStore();
  const song = store[songId] ?? {};
  const current = song[partId]?.cleanPassCount ?? 0;
  const cleanPassCount = isClean ? current + 1 : current;
  song[partId] = { cleanPassCount, lastPracticedAt: new Date().toISOString() };
  store[songId] = song;
  writeStore(store);
  return cleanPassCount;
}

export function clearExerciseProgress(songId: string, partId: string): void {
  const store = readStore();
  if (!store[songId]) return;
  delete store[songId][partId];
  writeStore(store);
}
