import { expect, Page, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const FIXTURE_WAV = path.resolve(__dirname, "..", "..", "apps", "worker", "fixtures", "synthetic_song.wav");
const FAKE_MIC_WAV = path.resolve(__dirname, "fixtures", "fake_mic_tone.wav");
const FAKE_MIC_TONE_HZ = 440; // constant tone - deliberately makes the two calibration steps indistinguishable, see below

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
// confident melody (see karaoke.spec.ts's difficulty-estimate step, which
// hits the same limitation), so song.vocalRange is null against the real
// pipeline output and the card under test would never render. Each test
// intercepts the song fetch to inject a fixed, known range instead - the
// rest of the pipeline (upload, ASR, melody, section/lyric rendering) still
// runs for real, only this one derived field is substituted.
const FORCED_SONG_RANGE = {
  lowestMidi: 60,
  highestMidi: 72,
  lowestNote: "C4",
  highestNote: "C5",
  semitoneRange: 12,
  sampleCount: 40,
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

async function forceVocalRange(page: Page, songId: string): Promise<void> {
  await page.route(`**/api/songs/${songId}`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const json = await response.json();
    json.vocalRange = FORCED_SONG_RANGE;
    await route.fulfill({ status: response.status(), contentType: "application/json", body: JSON.stringify(json) });
  });
}

test("vocal range card suggests a transpose that fits a pre-calibrated range, and applying it updates the practice key", async ({
  page,
}) => {
  const songId = await processSongAndReachPractice(page);
  await forceVocalRange(page, songId);
  // Seed a calibrated range without going through the mic flow (that's
  // covered separately below) - a 14-semitone user range offset from the
  // forced 12-semitone song range so exactly one shift (-3) makes it fit
  // fully; see evaluateVocalRangeFit's own unit tests for the general logic.
  await page.addInitScript((range) => {
    window.localStorage.setItem("singlearn_vocal_range", JSON.stringify(range));
  }, { lowestMidi: 55, highestMidi: 69 });
  await page.reload();

  await expect(page.getByText("Vocal range:").first()).toContainText("C4");
  await expect(page.getByText("G3–A4")).toBeVisible();
  await expect(page.getByText(/Shift by/)).toContainText("-3");

  await page.getByRole("button", { name: "Apply suggested transpose" }).click();
  await expect(page.getByText(/Applied/)).toBeVisible();
  await expect(page.getByRole("button", { name: "-3", exact: true })).toHaveClass("btn");
});

test("mic range calibration surfaces a clear retry when the two captured notes aren't actually different", async ({
  page,
}) => {
  const songId = await processSongAndReachPractice(page);
  await forceVocalRange(page, songId);
  await page.reload();

  await page.getByRole("button", { name: "Test your range" }).click();
  await expect(page.getByText("Hum and hold your lowest comfortable note")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Now hum and hold your highest comfortable note")).toBeVisible({ timeout: 10_000 });

  // The fake device plays one constant tone for both steps, so the "highest"
  // note can never come out actually higher than the "lowest" one - this
  // deterministically exercises the retry path without any timing-sensitive
  // fixture engineering.
  await expect(page.getByText(/didn't sound higher/)).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText(/didn't sound higher/)).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Test your range" })).toBeVisible();
});
