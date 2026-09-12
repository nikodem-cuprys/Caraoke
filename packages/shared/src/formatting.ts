/**
 * Display formatting for practice history (total time, "last practiced").
 * Not the same as PracticeControls' mm:ss formatter, which formats a
 * playback *position* within a song, not an aggregate duration or a
 * calendar timestamp.
 */

/** Formats a duration in seconds as a short human string: "45s", "12m", "1h 30m". */
export function formatDurationShort(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

/**
 * Formats an ISO timestamp as a short relative time: "just now", "5
 * minutes ago", "3 days ago". `nowMs` is injectable for deterministic
 * testing rather than reading Date.now() internally.
 */
export function formatRelativeTime(isoTimestamp: string, nowMs: number = Date.now()): string {
  const thenMs = new Date(isoTimestamp).getTime();
  const diffSec = Math.max(0, Math.round((nowMs - thenMs) / 1000));

  if (diffSec < 30) return "just now";
  if (diffSec < 60) return `${diffSec} seconds ago`;

  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;

  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour} hour${diffHour === 1 ? "" : "s"} ago`;

  const diffDay = Math.round(diffHour / 24);
  if (diffDay < 30) return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;

  const diffMonth = Math.round(diffDay / 30);
  if (diffMonth < 12) return `${diffMonth} month${diffMonth === 1 ? "" : "s"} ago`;

  const diffYear = Math.round(diffMonth / 12);
  return `${diffYear} year${diffYear === 1 ? "" : "s"} ago`;
}
