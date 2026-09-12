import { transposePitchClass } from "@singlearn/shared";
import { expect, test } from "@playwright/test";
import path from "node:path";

const FIXTURE_WAV = path.resolve(__dirname, "..", "..", "apps", "worker", "fixtures", "synthetic_song.wav");

test.describe.configure({ mode: "serial" });

// The player renders up to three <audio> elements at once (reference,
// vocals, instrumental - see usePlayer.ts). Exactly which one is "primary"
// depends on whether stem separation was available for this song, and the
// inactive ones are rendered with no src, so `document.querySelector`
// (which always returns the first element regardless of which is actually
// driving playback) is not a safe way to read the canonical time from the
// page - read the maximum currentTime across every audio element instead.
function currentAudioTime(): number {
  return Math.max(0, ...Array.from(document.querySelectorAll("audio")).map((a) => a.currentTime || 0));
}

test("paste a YouTube link, upload authorized audio, process, and practice the resulting karaoke", async ({ page }) => {
  await page.goto("/");

  await test.step("paste link and identify the song", async () => {
    await page.locator("#youtube-url").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    await page.getByRole("button", { name: "Create Karaoke" }).click();
    await expect(page.getByText("Rick Astley").first()).toBeVisible({ timeout: 15_000 });
  });

  await test.step("upload authorized audio and start processing", async () => {
    await page.locator('[data-testid="audio-file-input"]').setInputFiles(FIXTURE_WAV);
    await page.waitForURL(/\/songs\/.+\/processing/, { timeout: 15_000 });
  });

  const songId = page.url().match(/\/songs\/([^/]+)\/processing/)?.[1];
  expect(songId).toBeTruthy();

  await test.step("wait for the real pipeline to finish and land on the karaoke player", async () => {
    await expect(page.getByText("Detecting melody")).toBeVisible({ timeout: 20_000 });
    await page.waitForURL(new RegExp(`/songs/${songId}/practice`), { timeout: 150_000 });
  });

  await test.step("lyrics render with the words the real ASR pipeline transcribed", async () => {
    await expect(page.locator('[data-testid="active-line"], [data-testid="lyric-word"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="lyric-word"]', { hasText: "sun" }).first()).toBeVisible({ timeout: 10_000 });
  });

  await test.step("play, and confirm the canonical timeline advances and highlights a word", async () => {
    await page.getByRole("button", { name: "Play" }).click();

    // The fixture's sung line covers only the first ~1.5s of a ~3s clip, so
    // check for word highlighting (true from the very first frame of
    // playback) before checking elapsed time - the UI's current-time only
    // updates once per whole second, and waiting on that first would burn
    // most of the lyric's short active window before the second check ever
    // got a chance to run.
    await expect
      .poll(async () => page.locator('[data-testid="lyric-word"][data-active="true"]').count(), { timeout: 8000 })
      .toBeGreaterThan(0);

    await expect.poll(async () => page.evaluate(currentAudioTime), { timeout: 8000 }).toBeGreaterThan(0);

    await page.getByRole("button", { name: "Pause" }).click();
  });

  await test.step("seek via the waveform", async () => {
    const waveform = page.locator('[data-testid="waveform"]');
    const box = await waveform.boundingBox();
    expect(box).toBeTruthy();
    if (box) {
      await waveform.click({ position: { x: box.width * 0.7, y: box.height / 2 } });
    }
    await expect
      .poll(async () => page.locator('[data-testid="current-time"]').first().textContent())
      .not.toBe("0:00");
  });

  await test.step("jump between sections", async () => {
    const chips = page.locator('[data-testid="section-chip"]');
    await expect(chips.first()).toBeVisible();
    const chipCount = await chips.count();

    // Whichever section covers t=0 (the fixture's single line) should be
    // marked active right after seeking back to the start via the chip.
    await chips.first().click();
    await expect
      .poll(async () => page.locator('[data-testid="current-time"]').first().textContent())
      .toBe("0:00");
    await expect(chips.first()).toHaveAttribute("data-active", "true");

    if (chipCount > 1) {
      await page.getByTestId("section-nav-next").click();
      await expect
        .poll(async () => page.locator('[data-testid="current-time"]').first().textContent())
        .not.toBe("0:00");
    }
  });

  await test.step("loop the active lyric line", async () => {
    await page.locator('[data-testid="active-line"], [data-testid="lyric-word"]').first().scrollIntoViewIfNeeded();
    // Seek back to the start so there is an active line to loop.
    const waveform = page.locator('[data-testid="waveform"]');
    const box = await waveform.boundingBox();
    if (box) await waveform.click({ position: { x: 2, y: box.height / 2 } });

    await page.locator('[data-testid="active-line"]').dblclick();
    await expect(page.getByText(/Looping line/)).toBeVisible();
    await page.getByRole("button", { name: "Stop looping" }).click();
  });

  await test.step("transpose the practice key", async () => {
    const keyText = await page.getByText(/^Estimated key:/).textContent();
    const match = /Estimated key:\s*([A-G][#b]?)\s+(major|minor)/.exec(keyText ?? "");
    expect(match).toBeTruthy();
    const [, tonic, mode] = match as RegExpExecArray;

    await page.getByRole("button", { name: "+2", exact: true }).click();

    const expectedTonic = transposePitchClass(tonic, 2);
    await expect(page.getByText(`practicing in`)).toContainText(`${expectedTonic} ${mode}`);

    // Reset so it doesn't leak into later steps in this serial test.
    await page.getByRole("button", { name: "0", exact: true }).click();
  });

  await test.step("change playback speed", async () => {
    await page.getByRole("button", { name: "0.75×" }).click();
    const rate = await page.evaluate(() => {
      const audio = document.querySelector("audio");
      return audio?.playbackRate;
    });
    expect(rate).toBe(0.75);
  });

  await test.step("difficulty estimate and practice history", async () => {
    // This fixture's TTS-spoken "singing" doesn't reliably produce a
    // confident vocal range (see microphonePractice.spec.ts's comment on
    // the same limitation), so the honest "not enough data" fallback is
    // what should actually appear here, not a fabricated rating.
    await expect(page.getByText("Not enough confident melody data to estimate difficulty yet.")).toBeVisible();

    // usePracticeSession starts a session in the background as soon as the
    // practice page mounts; the song data used to render "Not practiced
    // yet" below was fetched before that resolved, so this is the correct
    // first-load state, not a bug.
    await expect(page.getByText("Not practiced yet")).toBeVisible();

    // Reloading re-fetches the song after the earlier session-start call
    // has long since resolved, so it should now be reflected. Not
    // asserting an exact count of 1: Next's dev server runs React
    // StrictMode, which deliberately mounts every component twice
    // (mount/unmount/remount) to surface effect bugs, so a real practice
    // session and one honestly-short-lived StrictMode artifact session
    // are both expected on a single dev-mode page load.
    await page.reload();
    await expect(page.getByText(/^Practiced \d+ times?/)).toBeVisible({ timeout: 10_000 });
  });
});
