import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const FIXTURE_WAV = path.resolve(__dirname, "..", "..", "apps", "worker", "fixtures", "synthetic_song.wav");
const FAKE_MIC_WAV = path.resolve(__dirname, "fixtures", "fake_mic_tone.wav");
const FAKE_MIC_TONE_HZ = 440; // A4 - arbitrary; this test checks detection works at all, not a specific target match

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

// Generated once at module load (before Playwright launches the browser
// this file's test.use() below configures), so its path can be baked into
// the fixed --use-file-for-fake-audio-capture launch argument. A synthetic
// tone, same as the rest of the suite's fixtures - no real recording.
fs.mkdirSync(path.dirname(FAKE_MIC_WAV), { recursive: true });
writeMonoPcm16Wav(FAKE_MIC_WAV, FAKE_MIC_TONE_HZ, 15);

test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      // Without this, getUserMedia() rejects with NotSupportedError before
      // ever reaching the fake device, regardless of the `permissions`
      // context option below - discovered by bisecting this exact
      // combination of flags, not documented anywhere obvious.
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-audio-capture=${FAKE_MIC_WAV}`,
    ],
  },
  permissions: ["microphone"],
});

test.describe.configure({ mode: "serial" });

test("microphone practice detects live pitch from the mic and produces feedback", async ({ page }) => {
  await page.goto("/");

  await page.locator("#youtube-url").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await page.getByRole("button", { name: "Create Karaoke" }).click();
  await expect(page.getByText("Rick Astley").first()).toBeVisible({ timeout: 15_000 });

  await page.locator('[data-testid="audio-file-input"]').setInputFiles(FIXTURE_WAV);
  await page.waitForURL(/\/songs\/.+\/processing/, { timeout: 15_000 });
  const songId = page.url().match(/\/songs\/([^/]+)\/processing/)?.[1];
  await page.waitForURL(new RegExp(`/songs/${songId}/practice`), { timeout: 150_000 });

  await page.getByRole("button", { name: "Enable microphone practice" }).click();
  await expect(page.getByText("Microphone practice active")).toBeVisible({ timeout: 10_000 });

  // Confirm the mic pipeline actually detected the fake device's tone
  // (mic -> getUserMedia -> AudioContext -> AnalyserNode -> autocorrelate()
  // -> React state), not just that the UI switched into "enabled" state.
  // Checked independent of the target-melody overlay ("You: N cents"),
  // which only appears while a confident target note is active - this
  // fixture's TTS-spoken "singing" doesn't reliably produce one, so
  // asserting on it here would be testing the melody pipeline's
  // confidence filtering (already covered elsewhere), not the mic feature.
  await expect(page.getByTestId("mic-live-status")).toHaveText(/detected [A-G]/, { timeout: 10_000 });

  await page.getByRole("button", { name: "Play" }).click();

  await page.getByRole("button", { name: "Get feedback on this take" }).click();
  await expect(page.locator("li").first()).toBeVisible();

  await page.getByRole("button", { name: "Disable" }).click();
  await expect(page.getByText("Microphone practice active")).toHaveCount(0);
});
