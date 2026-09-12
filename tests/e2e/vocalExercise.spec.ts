import { expect, Page, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const FIXTURE_WAV = path.resolve(__dirname, "..", "..", "apps", "worker", "fixtures", "synthetic_song.wav");
const FAKE_MIC_WAV = path.resolve(__dirname, "fixtures", "fake_mic_tone.wav");
const FAKE_MIC_TONE_HZ = 440; // A4 / midi 69 - matches the forced target note below, so attempts come out in tune

function writeMonoPcm16Wav(filePath: string, frequencyHz: number, durationSec: number, sampleRate = 44100): void {
  const numSamples = Math.floor(durationSec * sampleRate);
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate = sampleRate * blockAlign
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.round(0.5 * 32767 * Math.sin((2 * Math.PI * frequencyHz * i) / sampleRate));
    buffer.writeInt16LE(sample, 44 + i * 2);
  }
  fs.writeFileSync(filePath, buffer);
}

fs.mkdirSync(path.dirname(FAKE_MIC_WAV), { recursive: true });
writeMonoPcm16Wav(FAKE_MIC_WAV, FAKE_MIC_TONE_HZ, 15);

test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-audio-capture=${FAKE_MIC_WAV}`,
    ],
  },
  permissions: ["microphone"],
});

test.describe.configure({ mode: "serial" });

// The synthetic fixture's TTS-spoken "singing" doesn't reliably produce a
// confident melody, so song.difficultParts (derived from it) is normally
// empty for it - same limitation vocalRangeFit.spec.ts documents for
// song.vocalRange. This intercepts the song fetch to inject one fixed
// difficult passage and a matching target note (A4/midi 69, the same pitch
// the fake mic device sings), so the exercise flow can be exercised for
// real against a known, in-tune target.
const FORCED_PART = {
  id: "forced-difficult-part",
  start: 0.1,
  end: 1.0,
  reason: "large_interval_jump",
  detail: "Forced by the vocal-exercise e2e test.",
  severity: 0.6,
};
const FORCED_NOTE = {
  id: "forced-note",
  start: 0.1,
  end: 1.0,
  midi: 69,
  noteName: "A4",
  confidence: 0.9,
  meanFrequencyHz: 440,
};

async function processSongAndReachPractice(page: Page): Promise<string> {
  await page.goto("/");
  await page.locator("#youtube-url").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await page.getByRole("button", { name: "Create Karaoke" }).click();
  await expect(page.getByText("Rick Astley").first()).toBeVisible({ timeout: 15_000 });

  await page.locator('[data-testid="audio-file-input"]').setInputFiles(FIXTURE_WAV);
  await page.waitForURL(/\/songs\/.+\/processing/, { timeout: 15_000 });
  const songId = page.url().match(/\/songs\/([^/]+)\/processing/)?.[1] as string;
  await page.waitForURL(new RegExp(`/songs/${songId}/practice`), { timeout: 150_000 });
  return songId;
}

async function forceDifficultPart(page: Page, songId: string): Promise<void> {
  await page.route(`**/api/songs/${songId}`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const json = await response.json();
    json.difficultParts = [FORCED_PART];
    json.melodyNotes = [FORCED_NOTE];
    await route.fulfill({ status: response.status(), contentType: "application/json", body: JSON.stringify(json) });
  });
}

test("practicing a difficult passage tracks clean passes up to mastery, then restores speed on exit", async ({ page }) => {
  const songId = await processSongAndReachPractice(page);
  await forceDifficultPart(page, songId);
  await page.reload();

  await expect(page.getByText("Large pitch jump")).toBeVisible();

  await page.getByRole("button", { name: "Practice this" }).click();
  await expect(page.getByRole("button", { name: "0.75×", exact: true })).toHaveClass("btn", { timeout: 10_000 });
  // Looping alone doesn't advance the timeline - actually play through the
  // loop so the canonical currentTime (and the mic samples timestamped
  // against it) enters the forced note's window at all.
  await page.getByRole("button", { name: "Play" }).click();

  // "Check this attempt" judges whatever samples have accumulated at click
  // time - it doesn't retry itself. A fixed sleep-then-click-once here was
  // flaky in CI (a slower/headed xvfb runner needs more real time than a
  // local dev machine to accumulate enough confident samples, especially at
  // the exercise's 0.75x playback rate), so poll: keep clicking until a
  // clean pass actually registers, rather than assuming one attempt is
  // always enough.
  async function checkUntilCleanPass(): Promise<void> {
    await expect(async () => {
      await page.getByRole("button", { name: "Check this attempt" }).click();
      await expect(page.getByText("Clean pass! ✓")).toBeVisible({ timeout: 500 });
    }).toPass({ timeout: 30_000, intervals: [1000] });
  }

  for (let i = 1; i <= 3; i++) {
    await checkUntilCleanPass();
    await expect(page.getByText(`${i}/3 clean passes`)).toBeVisible();
  }

  await expect(page.getByText("Mastered ✓")).toBeVisible();

  await page.getByRole("button", { name: "Done practicing" }).click();
  await expect(page.getByRole("button", { name: "1×", exact: true })).toHaveClass("btn");
  await expect(page.getByRole("button", { name: "Practice this" })).toBeVisible();
  // Mastery persists after exiting the exercise, not just while it's active.
  await expect(page.getByText("Mastered ✓")).toBeVisible();
});
