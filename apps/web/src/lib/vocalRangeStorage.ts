import type { MidiRange } from "@singlearn/shared";

const STORAGE_KEY = "singlearn_vocal_range";

/**
 * The user's self-calibrated vocal range (see VocalRangeCard) persists
 * per-browser in localStorage, the same lightweight, no-accounts approach
 * clientId.ts uses for library scoping - there is nothing sensitive here
 * (just two MIDI numbers), so it isn't worth a server round-trip.
 */
export function getStoredVocalRange(): MidiRange | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.lowestMidi === "number" &&
      typeof parsed?.highestMidi === "number" &&
      parsed.lowestMidi < parsed.highestMidi
    ) {
      return { lowestMidi: parsed.lowestMidi, highestMidi: parsed.highestMidi };
    }
    return null;
  } catch {
    return null;
  }
}

export function setStoredVocalRange(range: MidiRange): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(range));
  } catch {
    // Best-effort only - a user in private browsing or with storage
    // disabled just recalibrates each visit instead of persisting.
  }
}

export function clearStoredVocalRange(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
