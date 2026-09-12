import { describe, expect, it } from "vitest";
import { computeReviewSchedule } from "../reviewSchedule";

describe("computeReviewSchedule", () => {
  const now = new Date("2026-01-15T00:00:00.000Z");

  it("has no schedule for a never-practiced song", () => {
    expect(computeReviewSchedule(0, null, now)).toEqual({ dueAt: null, isDue: false, intervalDays: null });
  });

  it("schedules a 1-day interval after the first session", () => {
    const lastPracticedAt = new Date("2026-01-14T00:00:00.000Z").toISOString();
    const schedule = computeReviewSchedule(1, lastPracticedAt, now);
    expect(schedule.intervalDays).toBe(1);
    expect(schedule.dueAt).toBe(new Date("2026-01-15T00:00:00.000Z").toISOString());
    expect(schedule.isDue).toBe(true);
  });

  it("is not due when the interval hasn't elapsed yet", () => {
    const lastPracticedAt = new Date("2026-01-14T12:00:00.000Z").toISOString();
    const schedule = computeReviewSchedule(1, lastPracticedAt, now);
    expect(schedule.isDue).toBe(false);
  });

  it("grows the interval with more sessions", () => {
    const lastPracticedAt = new Date("2026-01-01T00:00:00.000Z").toISOString();
    expect(computeReviewSchedule(2, lastPracticedAt, now).intervalDays).toBe(3);
    expect(computeReviewSchedule(3, lastPracticedAt, now).intervalDays).toBe(7);
    expect(computeReviewSchedule(4, lastPracticedAt, now).intervalDays).toBe(14);
  });

  it("caps the interval at the longest defined step for very high session counts", () => {
    const lastPracticedAt = new Date("2026-01-01T00:00:00.000Z").toISOString();
    expect(computeReviewSchedule(6, lastPracticedAt, now).intervalDays).toBe(60);
    expect(computeReviewSchedule(50, lastPracticedAt, now).intervalDays).toBe(60);
  });
});
