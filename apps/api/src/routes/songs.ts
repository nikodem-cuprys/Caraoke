import { Router } from "express";
import multer from "multer";
import os from "node:os";
import { createSongSchema, correctWordSchema, editSectionSchema, languageOverrideSchema } from "../validation/schemas";
import {
  attachUploadedAudio,
  assembleSongDTO,
  createSongFromYoutubeUrl,
  listSongsForClient,
  summarizePracticeSessions,
} from "../services/songService";
import { clientOwnerId } from "../middleware/errorHandler";
import { rateLimitProcessingJobs } from "../middleware/rateLimiter";
import { config } from "../config";
import { prisma } from "../db/client";
import { toJobDTO } from "../services/jobService";

export const songsRouter = Router();

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024 },
});

const ALLOWED_UPLOAD_MIME_PREFIXES = ["audio/", "video/mp4", "video/webm", "video/quicktime"];

songsRouter.post("/", rateLimitProcessingJobs, async (req, res, next) => {
  try {
    const body = createSongSchema.parse(req.body);
    const song = await createSongFromYoutubeUrl(body.youtubeUrl, clientOwnerId(req));
    res.status(201).json({
      songId: song.id,
      title: song.title,
      artist: song.artist,
      thumbnailUrl: song.thumbnailUrl,
      youtubeVideoId: song.source?.youtubeVideoId ?? null,
      audioRequired: true,
    });
  } catch (err) {
    next(err);
  }
});

songsRouter.get("/", async (req, res, next) => {
  try {
    const songs = await listSongsForClient(clientOwnerId(req));
    res.json(
      songs.map((s) => ({
        id: s.id,
        title: s.title,
        artist: s.artist,
        thumbnailUrl: s.thumbnailUrl,
        durationSec: s.durationSec,
        status: s.job?.status ?? "awaiting_audio",
        createdAt: s.createdAt,
        practiceSummary: summarizePracticeSessions(s.practiceSessions),
      }))
    );
  } catch (err) {
    next(err);
  }
});

songsRouter.get("/:id", async (req, res, next) => {
  try {
    const dto = await assembleSongDTO(req.params.id, clientOwnerId(req));
    res.json(dto);
  } catch (err) {
    next(err);
  }
});

songsRouter.post("/:id/audio", upload.single("audio"), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "No audio file uploaded" });
      return;
    }
    const mimeOk = ALLOWED_UPLOAD_MIME_PREFIXES.some((p) => req.file!.mimetype.startsWith(p));
    if (!mimeOk) {
      res.status(400).json({ error: `Unsupported file type: ${req.file.mimetype}` });
      return;
    }

    const songId = req.params.id as string;
    const song = await prisma.song.findUniqueOrThrow({ where: { id: songId } });
    if (song.clientOwnerId !== clientOwnerId(req)) {
      res.status(403).json({ error: "Not authorized to modify this song" });
      return;
    }

    const result = await attachUploadedAudio(songId, req.file.path, req.file.mimetype, config.maxSongDurationSec);
    res.status(202).json(result);
  } catch (err) {
    next(err);
  }
});

songsRouter.patch("/:id/words/:wordId", async (req, res, next) => {
  try {
    const body = correctWordSchema.parse({ ...req.body, wordId: req.params.wordId });
    const song = await prisma.song.findUniqueOrThrow({ where: { id: req.params.id } });
    if (song.clientOwnerId !== clientOwnerId(req)) {
      res.status(403).json({ error: "Not authorized" });
      return;
    }
    const word = await prisma.lyricWord.findUniqueOrThrow({ where: { id: body.wordId } });
    await prisma.userCorrection.create({
      data: { wordId: word.id, previousText: word.text, newText: body.text, clientId: clientOwnerId(req) },
    });
    // Correcting text never touches start/end — synchronization is preserved.
    await prisma.lyricWord.update({ where: { id: word.id }, data: { text: body.text, isUserCorrected: true } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

songsRouter.patch("/:id/sections/:sectionId", async (req, res, next) => {
  try {
    const body = editSectionSchema.parse(req.body);
    const song = await prisma.song.findUniqueOrThrow({ where: { id: req.params.id } });
    if (song.clientOwnerId !== clientOwnerId(req)) {
      res.status(403).json({ error: "Not authorized" });
      return;
    }
    await prisma.songSection.update({
      where: { id: req.params.sectionId },
      data: { ...body, isEstimated: false },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

songsRouter.patch("/:id/language", async (req, res, next) => {
  try {
    const body = languageOverrideSchema.parse(req.body);
    const song = await prisma.song.findUniqueOrThrow({ where: { id: req.params.id } });
    if (song.clientOwnerId !== clientOwnerId(req)) {
      res.status(403).json({ error: "Not authorized" });
      return;
    }
    await prisma.song.update({ where: { id: req.params.id }, data: { language: body.language, languageIsUserOverride: true } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

songsRouter.get("/:id/job", async (req, res, next) => {
  try {
    const song = await prisma.song.findUniqueOrThrow({ where: { id: req.params.id }, include: { job: true } });
    if (!song.job) {
      res.status(404).json({ error: "No processing job yet" });
      return;
    }
    res.json(await toJobDTO(song.job.id));
  } catch (err) {
    next(err);
  }
});

// Practice history (command.txt FUTURE FEATURES: "practice history"). A
// session starts when the practice page mounts and is repeatedly
// heartbeat-extended (see PATCH below) while it stays open, rather than
// relying on a single "end" call that a closed tab/crashed browser would
// never get a chance to send.
songsRouter.post("/:id/practice-sessions", async (req, res, next) => {
  try {
    const song = await prisma.song.findUniqueOrThrow({ where: { id: req.params.id } });
    if (song.clientOwnerId !== clientOwnerId(req)) {
      res.status(403).json({ error: "Not authorized" });
      return;
    }
    const session = await prisma.practiceSession.create({
      data: { songId: req.params.id, clientId: clientOwnerId(req) },
    });
    res.status(201).json({ id: session.id });
  } catch (err) {
    next(err);
  }
});

// Heartbeat/end: sets endedAt to now. Called repeatedly while the practice
// page stays open (see apps/web/src/lib/usePracticeSession.ts) so the
// worst case of a missed final call is a session under-counted by one
// heartbeat interval, never one that hangs open indefinitely.
songsRouter.patch("/:id/practice-sessions/:sessionId", async (req, res, next) => {
  try {
    const song = await prisma.song.findUniqueOrThrow({ where: { id: req.params.id } });
    if (song.clientOwnerId !== clientOwnerId(req)) {
      res.status(403).json({ error: "Not authorized" });
      return;
    }
    const session = await prisma.practiceSession.findUniqueOrThrow({ where: { id: req.params.sessionId } });
    if (session.songId !== req.params.id || session.clientId !== clientOwnerId(req)) {
      res.status(403).json({ error: "Not authorized" });
      return;
    }
    await prisma.practiceSession.update({ where: { id: session.id }, data: { endedAt: new Date() } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
