import { Router } from "express";
import path from "node:path";
import { getQueueProvider } from "../queue";
import { prisma } from "../db/client";
import { getStorageProvider } from "../storage";
import { config } from "../config";
import { updateStage, markJobFailed } from "../services/jobService";
import { stageUpdateSchema, submitLyricsSchema, submitMelodySchema, submitSectionsSchema } from "../validation/schemas";

export const workerRouter = Router();

workerRouter.get("/queue/claim", async (_req, res, next) => {
  try {
    const jobId = await getQueueProvider().claimNext();
    if (!jobId) {
      res.json({ job: null });
      return;
    }

    const job = await prisma.processingJob.findUniqueOrThrow({
      where: { id: jobId },
      include: { song: { include: { assets: true } } },
    });

    const originalUpload = job.song.assets.find((a) => a.kind === "original_upload");
    if (!originalUpload) {
      await markJobFailed(jobId, "No original_upload audio asset found for this job");
      res.json({ job: null });
      return;
    }

    const storage = getStorageProvider();
    let sourceAudioLocalPath: string | null = null;
    try {
      sourceAudioLocalPath = storage.resolveLocalPath(originalUpload.storageKey);
    } catch {
      sourceAudioLocalPath = null; // e.g. S3 mode: worker must download via signed URL itself
    }

    res.json({
      job: {
        jobId: job.id,
        songId: job.songId,
        contentHash: job.song.contentHash,
        songDurationSec: job.song.durationSec,
        sourceAudioLocalPath,
        sourceAudioSignedUrl: sourceAudioLocalPath ? null : await storage.getSignedUrl(originalUpload.storageKey),
        sourceAudioMimeType: originalUpload.mimeType,
        storageKeyPrefix: `songs/${job.songId}/`,
        storageLocalRoot: config.storageProvider === "local" ? path.resolve(config.storageLocalRoot) : null,
        separationEngine: config.separationEngine,
        languageOverride: job.song.language,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Presigned upload URL for the worker to write a finished asset directly to
 * object storage (only meaningful when STORAGE_PROVIDER=s3 - the worker
 * decides whether it needs this at all based on whether claim/queue gave it
 * a storageLocalRoot). Scoped to the requesting job's own song folder so a
 * compromised or buggy worker can't obtain a write URL for arbitrary keys.
 */
workerRouter.get("/jobs/:jobId/upload-url", async (req, res, next) => {
  try {
    const key = typeof req.query.key === "string" ? req.query.key : null;
    const contentType = typeof req.query.contentType === "string" ? req.query.contentType : "application/octet-stream";
    if (!key) {
      res.status(400).json({ error: "key query parameter is required" });
      return;
    }

    const job = await prisma.processingJob.findUniqueOrThrow({ where: { id: req.params.jobId } });
    const expectedPrefix = `songs/${job.songId}/`;
    if (!key.startsWith(expectedPrefix)) {
      res.status(403).json({ error: "key must be scoped to this job's song" });
      return;
    }

    const uploadUrl = await getStorageProvider().getUploadUrl(key, contentType);
    res.json({ uploadUrl, key });
  } catch (err) {
    next(err);
  }
});

workerRouter.post("/jobs/:jobId/stage", async (req, res, next) => {
  try {
    const body = stageUpdateSchema.parse(req.body);
    await updateStage(req.params.jobId, body.name, body);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

workerRouter.post("/jobs/:jobId/assets", async (req, res, next) => {
  try {
    const { kind, storageKey, mimeType, durationSec, sizeBytes, providerName } = req.body;
    const job = await prisma.processingJob.findUniqueOrThrow({ where: { id: req.params.jobId } });
    await prisma.audioAsset.create({
      data: { songId: job.songId, kind, storageKey, mimeType, durationSec, sizeBytes, providerName },
    });
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

workerRouter.post("/jobs/:jobId/lyrics", async (req, res, next) => {
  try {
    const body = submitLyricsSchema.parse(req.body);
    const job = await prisma.processingJob.findUniqueOrThrow({ where: { id: req.params.jobId } });

    await prisma.lyricLine.deleteMany({ where: { songId: job.songId } });
    for (let i = 0; i < body.lines.length; i++) {
      const line = body.lines[i];
      await prisma.lyricLine.create({
        data: {
          songId: job.songId,
          index: i,
          start: line.start,
          end: line.end,
          words: {
            create: line.words.map((w, wi) => ({
              index: wi,
              text: w.text,
              start: w.start,
              end: w.end,
              confidence: w.confidence,
            })),
          },
        },
      });
    }
    await prisma.song.update({
      where: { id: job.songId },
      data: { language: body.language, languageIsUserOverride: false },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

workerRouter.post("/jobs/:jobId/melody", async (req, res, next) => {
  try {
    const body = submitMelodySchema.parse(req.body);
    const job = await prisma.processingJob.findUniqueOrThrow({ where: { id: req.params.jobId } });

    await prisma.melodyNote.deleteMany({ where: { songId: job.songId } });
    await prisma.melodyNote.createMany({
      data: body.notes.map((n) => ({ songId: job.songId, ...n })),
    });

    await prisma.difficultPart.deleteMany({ where: { songId: job.songId } });
    await prisma.difficultPart.createMany({
      data: body.difficultParts.map((d) => ({ songId: job.songId, ...d })),
    });

    await prisma.song.update({
      where: { id: job.songId },
      data: {
        vocalRangeJson: body.vocalRange ? JSON.stringify(body.vocalRange) : null,
        keyEstimateJson: body.keyEstimate ? JSON.stringify(body.keyEstimate) : null,
      },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

workerRouter.post("/jobs/:jobId/sections", async (req, res, next) => {
  try {
    const body = submitSectionsSchema.parse(req.body);
    const job = await prisma.processingJob.findUniqueOrThrow({ where: { id: req.params.jobId } });

    await prisma.songSection.deleteMany({ where: { songId: job.songId } });
    await prisma.songSection.createMany({
      data: body.sections.map((s) => ({ songId: job.songId, ...s })),
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

workerRouter.post("/jobs/:jobId/fail", async (req, res, next) => {
  try {
    await markJobFailed(req.params.jobId, req.body.error ?? "Unknown worker error");
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
