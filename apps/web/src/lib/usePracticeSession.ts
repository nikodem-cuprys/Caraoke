"use client";

import { useEffect, useRef } from "react";
import { pingPracticeSession, startPracticeSession } from "./apiClient";

const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Tracks one practice history session for a song (command.txt FUTURE
 * FEATURES: "practice history"): starts a session when this hook mounts
 * (the practice page is open) and repeatedly heartbeat-extends it while
 * mounted, rather than relying on a single "end" call that a closed tab or
 * crashed browser would never get a chance to send - the worst case of a
 * missed final heartbeat is a session under-counted by one interval, not
 * one left open indefinitely. Failures here are non-fatal to the practice
 * experience itself, so they're swallowed rather than surfaced.
 */
export function usePracticeSession(songId: string): void {
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    startPracticeSession(songId)
      .then(({ id }) => {
        if (cancelled) {
          // Unmounted before this resolved (e.g. React StrictMode's
          // deliberate dev-mode mount/unmount/remount, or just fast
          // navigation) - end the session immediately rather than setting
          // up a heartbeat interval for an already-unmounted component,
          // which would leak forever with nothing left to clear it.
          pingPracticeSession(songId, id).catch(() => {});
          return;
        }
        sessionIdRef.current = id;
        interval = setInterval(() => {
          if (sessionIdRef.current) pingPracticeSession(songId, sessionIdRef.current).catch(() => {});
        }, HEARTBEAT_INTERVAL_MS);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      if (sessionIdRef.current) pingPracticeSession(songId, sessionIdRef.current).catch(() => {});
    };
  }, [songId]);
}
