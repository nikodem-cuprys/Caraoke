import { describe, expect, it } from "vitest";
import { formatDurationShort, formatRelativeTime } from "../formatting";

describe("formatDurationShort", () => {
  it.each([
    [0, "0s"],
    [45, "45s"],
    [59, "59s"],
    [60, "1m"],
    [125, "2m"],
    [3599, "59m"],
    [3600, "1h"],
    [5400, "1h 30m"],
    [7260, "2h 1m"],
  ])("%i seconds -> %s", (seconds, expected) => {
    expect(formatDurationShort(seconds)).toBe(expected);
  });

  it("clamps negative durations to 0", () => {
    expect(formatDurationShort(-5)).toBe("0s");
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-01-01T12:00:00.000Z").getTime();

  it("reports very recent timestamps as 'just now'", () => {
    expect(formatRelativeTime(new Date(now - 5_000).toISOString(), now)).toBe("just now");
  });

  it.each([
    [45_000, "45 seconds ago"],
    [5 * 60_000, "5 minutes ago"],
    [60_000, "1 minute ago"],
    [3 * 3_600_000, "3 hours ago"],
    [3_600_000, "1 hour ago"],
    [2 * 86_400_000, "2 days ago"],
  ])("%i ms ago -> %s", (msAgo, expected) => {
    expect(formatRelativeTime(new Date(now - msAgo).toISOString(), now)).toBe(expected);
  });

  it("never reports a negative/future time as ago", () => {
    expect(formatRelativeTime(new Date(now + 10_000).toISOString(), now)).toBe("just now");
  });
});
