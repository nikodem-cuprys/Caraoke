import { expect, Page, test } from "@playwright/test";
import path from "node:path";

const FIXTURE_WAV = path.resolve(__dirname, "..", "..", "apps", "worker", "fixtures", "synthetic_song.wav");

test.describe.configure({ mode: "serial" });

test("library ranks a due-for-review song above a more recently created one that isn't due yet", async ({ page }) => {
  const dueSong = {
    id: "song-due",
    title: "Due Song",
    artist: null,
    thumbnailUrl: null,
    durationSec: 180,
    status: "complete",
    createdAt: new Date(Date.now() - 100_000).toISOString(),
    practiceSummary: {
      sessionCount: 1,
      totalPracticeSec: 60,
      lastPracticedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), // 2 days ago - past the 1-day first-review interval
    },
  };
  const notDueSong = {
    id: "song-not-due",
    title: "Not Due Song",
    artist: null,
    thumbnailUrl: null,
    durationSec: 180,
    status: "complete",
    createdAt: new Date(Date.now() - 50_000).toISOString(), // newer than dueSong, so the server's default order would list it first
    practiceSummary: {
      sessionCount: 1,
      totalPracticeSec: 60,
      lastPracticedAt: new Date(Date.now() - 5 * 60_000).toISOString(), // 5 minutes ago - not due yet
    },
  };

  await page.route("**/api/songs", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    // Server order is newest-first; deliberately returned in that order
    // (not-due song first) so the assertions below actually prove the
    // client re-sorts due songs to the top rather than happening to
    // already be in that order.
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([notDueSong, dueSong]),
    });
  });

  await page.goto("/");

  const cards = page.getByTestId("song-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText("Due Song");
  await expect(cards.nth(0).getByText("Due for review")).toBeVisible();
  await expect(cards.nth(1)).toContainText("Not Due Song");
  await expect(cards.nth(1)).toContainText("next review due in");
});

test("the practice page's song insights panel flags a song due for review", async ({ page }) => {
  await page.goto("/");
  await page.locator("#youtube-url").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await page.getByRole("button", { name: "Create Karaoke" }).click();
  await expect(page.getByText("Rick Astley").first()).toBeVisible({ timeout: 15_000 });

  await page.locator('[data-testid="audio-file-input"]').setInputFiles(FIXTURE_WAV);
  await page.waitForURL(/\/songs\/.+\/processing/, { timeout: 15_000 });
  const songId = page.url().match(/\/songs\/([^/]+)\/processing/)?.[1] as string;
  await page.waitForURL(new RegExp(`/songs/${songId}/practice`), { timeout: 150_000 });

  // The real pipeline just created a genuine PracticeSession from this
  // page visit, but its lastPracticedAt is seconds old - nowhere near due.
  // Force it into the past via route interception (same technique as
  // vocalRangeFit.spec.ts) rather than waiting a real day for the schedule
  // to naturally come due.
  await page.route(`**/api/songs/${songId}`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const json = await response.json();
    json.practiceSummary = {
      sessionCount: 1,
      totalPracticeSec: 60,
      lastPracticedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    };
    await route.fulfill({ status: response.status(), contentType: "application/json", body: JSON.stringify(json) });
  });
  await page.reload();

  await expect(page.getByText("Due for review")).toBeVisible();
});
