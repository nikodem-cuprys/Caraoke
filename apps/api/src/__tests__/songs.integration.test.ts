import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../youtube/fetchYoutubeMetadata", () => ({
  fetchYoutubeMetadata: vi.fn(async (url: string) => {
    if (!url.includes("dQw4w9WgXcQ")) throw new Error("unexpected url in test mock");
    return {
      videoId: "dQw4w9WgXcQ",
      canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "Test Song",
      authorName: "Test Artist",
      thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    };
  }),
}));

import { createApp } from "../app";
import { prisma } from "../db/client";
import { resetDb } from "./testUtils";

const app = createApp();
const FIXTURE_WAV = path.join(__dirname, "fixtures", "tiny.wav");
const WORKER_SECRET = "test-worker-secret";

// Each test uses its own client id: the rate limiter's token bucket is a
// module-level singleton shared across the whole process, so reusing one id
// across many tests would spuriously trip the rate limit (that behavior is
// covered on its own in rateLimiter.test.ts).
let clientCounter = 0;
function uniqueClientId(): string {
  clientCounter += 1;
  return `test-client-${Date.now()}-${clientCounter}`;
}

async function createSongAndUpload(clientId: string) {
  const createRes = await request(app)
    .post("/api/songs")
    .set("X-Client-Id", clientId)
    .send({ youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
  expect(createRes.status).toBe(201);

  const songId = createRes.body.songId as string;
  const uploadRes = await request(app)
    .post(`/api/songs/${songId}/audio`)
    .set("X-Client-Id", clientId)
    .attach("audio", FIXTURE_WAV, { filename: "tiny.wav", contentType: "audio/wav" });
  return { songId, uploadRes };
}

async function driveJobToCompletion(jobId: string) {
  const stageNames = [
    "PREPARE_AUDIO",
    "SEPARATE_STEMS",
    "TRANSCRIBE",
    "ALIGN_WORDS",
    "DETECT_PITCH",
    "SIMPLIFY_MELODY",
    "SEGMENT_LYRICS",
    "GENERATE_WAVEFORM",
    "BUILD_KARAOKE",
  ];
  for (const name of stageNames) {
    const res = await request(app)
      .post(`/internal/jobs/${jobId}/stage`)
      .set("X-Worker-Secret", WORKER_SECRET)
      .send({ name, status: "done", detail: `${name} complete (test)` });
    expect(res.status).toBe(200);
  }

  await request(app)
    .post(`/internal/jobs/${jobId}/lyrics`)
    .set("X-Worker-Secret", WORKER_SECRET)
    .send({
      language: "en",
      languageConfidence: 0.95,
      lines: [
        {
          start: 0,
          end: 1.5,
          words: [
            { text: "hello", start: 0, end: 0.5, confidence: 0.92 },
            { text: "world", start: 0.6, end: 1.4, confidence: 0.4 },
          ],
        },
      ],
    })
    .expect(200);

  await request(app)
    .post(`/internal/jobs/${jobId}/sections`)
    .set("X-Worker-Secret", WORKER_SECRET)
    .send({ sections: [{ type: "verse", label: "Verse 1", start: 0, end: 1.5, confidence: 0.6, isEstimated: true }] })
    .expect(200);

  await request(app)
    .post(`/internal/jobs/${jobId}/melody`)
    .set("X-Worker-Secret", WORKER_SECRET)
    .send({
      notes: [{ start: 0, end: 0.5, midi: 69, noteName: "A4", confidence: 0.8, meanFrequencyHz: 440 }],
      vocalRange: { lowestMidi: 60, highestMidi: 72, lowestNote: "C4", highestNote: "C5", semitoneRange: 12, sampleCount: 100 },
      keyEstimate: { tonic: "C", mode: "major", confidence: 0.5 },
      difficultParts: [{ start: 0, end: 0.5, reason: "highest_note", detail: "Highest note in the song (estimate)", severity: 0.7 }],
    })
    .expect(200);

  await request(app)
    .post(`/internal/jobs/${jobId}/stage`)
    .set("X-Worker-Secret", WORKER_SECRET)
    .send({ name: "COMPLETE", status: "done" })
    .expect(200);
}

describe("song creation and processing pipeline", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a song from a validated YouTube URL and requires an audio upload before processing", async () => {
    const clientId = uniqueClientId();
    const res = await request(app)
      .post("/api/songs")
      .set("X-Client-Id", clientId)
      .send({ youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });

    expect(res.status).toBe(201);
    expect(res.body.audioRequired).toBe(true);
    expect(res.body.title).toBe("Test Song");

    const song = await request(app).get(`/api/songs/${res.body.songId}`).set("X-Client-Id", clientId);
    expect(song.status).toBe(200);
    expect(song.body.processingJob.stages).toHaveLength(0); // no job yet, audio not uploaded
  });

  it("uploading authorized audio creates a queued job with metadata/validation stages already done", async () => {
    const clientId = uniqueClientId();
    const { songId, uploadRes } = await createSongAndUpload(clientId);
    expect(uploadRes.status).toBe(202);
    expect(uploadRes.body.reused).toBe(false);

    const song = await request(app).get(`/api/songs/${songId}`).set("X-Client-Id", clientId);
    const stages = song.body.processingJob.stages;
    expect(song.body.processingJob.status).toBe("queued");
    expect(stages.find((s: any) => s.name === "FETCH_METADATA").status).toBe("done");
    expect(stages.find((s: any) => s.name === "VALIDATE_AUDIO_SOURCE").status).toBe("done");
    expect(stages.find((s: any) => s.name === "TRANSCRIBE").status).toBe("pending");
  });

  it("a worker can claim the job, resolve the local audio path, and drive it through all stages to completion", async () => {
    const clientId = uniqueClientId();
    const { songId, uploadRes } = await createSongAndUpload(clientId);
    const jobId = uploadRes.body.jobId as string;

    const claim = await request(app).get("/internal/queue/claim").set("X-Worker-Secret", WORKER_SECRET);
    expect(claim.status).toBe(200);
    expect(claim.body.job.songId).toBe(songId);
    expect(claim.body.job.sourceAudioLocalPath).toBeTruthy();
    expect(fs.existsSync(claim.body.job.sourceAudioLocalPath)).toBe(true);

    // A second immediate claim attempt should see no other queued job (already running/claimed).
    const claimAgain = await request(app).get("/internal/queue/claim").set("X-Worker-Secret", WORKER_SECRET);
    expect(claimAgain.body.job).toBeNull();

    await driveJobToCompletion(jobId);

    const finalSong = await request(app).get(`/api/songs/${songId}`).set("X-Client-Id", clientId);
    expect(finalSong.body.processingJob.status).toBe("complete");
    expect(finalSong.body.lines).toHaveLength(1);
    expect(finalSong.body.lines[0].words[0].text).toBe("hello");
    expect(finalSong.body.lines[0].words[1].lowConfidence).toBe(true); // confidence 0.4 < threshold
    expect(finalSong.body.melodyNotes).toHaveLength(1);
    expect(finalSong.body.vocalRange.semitoneRange).toBe(12);
    expect(finalSong.body.difficultParts).toHaveLength(1);
  });

  it("the internal worker endpoints reject requests without the shared secret", async () => {
    const res = await request(app).get("/internal/queue/claim");
    expect(res.status).toBe(401);
  });

  it("rejects access to another client's song", async () => {
    const { songId } = await createSongAndUpload("client-owner");
    const res = await request(app).get(`/api/songs/${songId}`).set("X-Client-Id", "someone-else");
    expect(res.status).toBe(403);
  });

  it("word text corrections update the word without touching its timestamps, and record a correction audit row", async () => {
    const clientId = uniqueClientId();
    const { songId, uploadRes } = await createSongAndUpload(clientId);
    await driveJobToCompletion(uploadRes.body.jobId);

    const song = await request(app).get(`/api/songs/${songId}`).set("X-Client-Id", clientId);
    const word = song.body.lines[0].words[0];
    expect(word.text).toBe("hello");

    const patchRes = await request(app)
      .patch(`/api/songs/${songId}/words/${word.id}`)
      .set("X-Client-Id", clientId)
      .send({ text: "halo" });
    expect(patchRes.status).toBe(200);

    const updated = await request(app).get(`/api/songs/${songId}`).set("X-Client-Id", clientId);
    const updatedWord = updated.body.lines[0].words[0];
    expect(updatedWord.text).toBe("halo");
    expect(updatedWord.isUserCorrected).toBe(true);
    expect(updatedWord.start).toBe(word.start);
    expect(updatedWord.end).toBe(word.end);

    const corrections = await prisma.userCorrection.findMany({ where: { wordId: word.id } });
    expect(corrections).toHaveLength(1);
    expect(corrections[0].previousText).toBe("hello");
    expect(corrections[0].newText).toBe("halo");
  });

  it("reuses cached results when identical audio content is uploaded for a different song", async () => {
    const clientId = uniqueClientId();
    const first = await createSongAndUpload(clientId);
    await driveJobToCompletion(first.uploadRes.body.jobId);

    const second = await createSongAndUpload(clientId);
    expect(second.uploadRes.body.reused).toBe(true);

    const secondSong = await request(app).get(`/api/songs/${second.songId}`).set("X-Client-Id", clientId);
    expect(secondSong.body.processingJob.status).toBe("complete");
    expect(secondSong.body.lines).toHaveLength(1);
    expect(secondSong.body.lines[0].words[0].text).toBe("hello");
  });

  it("the worker upload-url endpoint scopes keys to the job's own song and rejects mismatched ones", async () => {
    const clientId = uniqueClientId();
    const { songId, uploadRes } = await createSongAndUpload(clientId);
    const jobId = uploadRes.body.jobId as string;

    const missingKey = await request(app).get(`/internal/jobs/${jobId}/upload-url`).set("X-Worker-Secret", WORKER_SECRET);
    expect(missingKey.status).toBe(400);

    const wrongSong = await request(app)
      .get(`/internal/jobs/${jobId}/upload-url`)
      .query({ key: "songs/some-other-song/vocals.wav", contentType: "audio/wav" })
      .set("X-Worker-Secret", WORKER_SECRET);
    expect(wrongSong.status).toBe(403);

    // The local storage provider has no upload-URL concept (the worker
    // writes directly into the shared filesystem in local mode instead) --
    // a correctly-scoped key still fails, but past the security check, and
    // with a real error rather than silently returning something unusable.
    const scopedKey = await request(app)
      .get(`/internal/jobs/${jobId}/upload-url`)
      .query({ key: `songs/${songId}/vocals.wav`, contentType: "audio/wav" })
      .set("X-Worker-Secret", WORKER_SECRET);
    expect(scopedKey.status).toBe(500);
  });

  it("rejects a request with no audio file attached", async () => {
    const clientId = uniqueClientId();
    const createRes = await request(app)
      .post("/api/songs")
      .set("X-Client-Id", clientId)
      .send({ youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
    const res = await request(app).post(`/api/songs/${createRes.body.songId}/audio`).set("X-Client-Id", clientId);
    expect(res.status).toBe(400);
  });
});
