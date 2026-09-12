import crypto from "node:crypto";
import fs from "node:fs";
import {
  LOW_CONFIDENCE_THRESHOLD,
  downsamplePitchPoints,
  type AudioAssetsDTO,
  type PitchPointDTO,
  type SongDTO,
} from "@singlearn/shared";
import { fetchYoutubeMetadata } from "../youtube/fetchYoutubeMetadata";
import { prisma } from "../db/client";
import { getStorageProvider } from "../storage";
import { createProcessingJob, toJobDTO } from "./jobService";
import { getQueueProvider } from "../queue";
import { probeAudioFile } from "./audioProbe";

const PITCH_OVERVIEW_MAX_POINTS = 4000;

export async function createSongFromYoutubeUrl(youtubeUrl: string, clientOwnerId: string) {
  const metadata = await fetchYoutubeMetadata(youtubeUrl);

  const song = await prisma.song.create({
    data: {
      title: metadata.title,
      artist: metadata.authorName,
      thumbnailUrl: metadata.thumbnailUrl,
      durationSec: 0,
      clientOwnerId,
      source: {
        create: {
          kind: "youtube",
          youtubeVideoId: metadata.videoId,
          youtubeUrl: metadata.canonicalUrl,
          channelTitle: metadata.authorName,
          sourceThumbnailUrl: metadata.thumbnailUrl,
        },
      },
    },
    include: { source: true },
  });

  return song;
}

function sha256File(filePath: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

/**
 * Attach a user-uploaded, authorized audio file to a song and kick off (or
 * reuse) processing. If an identical file (by content hash) has already
 * been fully processed, that song's results are cloned into this song
 * instead of reprocessing from scratch (caching / idempotency requirement).
 */
export async function attachUploadedAudio(
  songId: string,
  tempFilePath: string,
  originalMimeType: string,
  maxDurationSec: number
) {
  const probe = await probeAudioFile(tempFilePath);
  if (probe.durationSec > maxDurationSec) {
    throw new Error(
      `Audio is ${Math.round(probe.durationSec)}s long, which exceeds the ${maxDurationSec}s limit for this deployment.`
    );
  }

  const contentHash = sha256File(tempFilePath);
  const storage = getStorageProvider();
  const storageKey = `songs/${songId}/original_upload_${Date.now()}`;
  const buffer = fs.readFileSync(tempFilePath);
  await storage.putObject(storageKey, buffer, originalMimeType);

  await prisma.audioAsset.create({
    data: {
      songId,
      kind: "original_upload",
      storageKey,
      mimeType: originalMimeType,
      durationSec: probe.durationSec,
      sizeBytes: buffer.byteLength,
      providerName: "UserUploadAudioProvider",
    },
  });

  await prisma.song.update({ where: { id: songId }, data: { contentHash, durationSec: probe.durationSec } });

  // Idempotency/caching: if another song already fully processed this exact
  // audio, clone its results instead of reprocessing.
  const existingComplete = await prisma.song.findFirst({
    where: { contentHash, id: { not: songId }, job: { status: "complete" } },
    include: { job: { include: { stages: true } } },
  });

  if (existingComplete) {
    await cloneProcessedResults(existingComplete.id, songId);
    return { reused: true };
  }

  const job = await createProcessingJob(songId, "user_upload");
  const { updateStage } = await import("./jobService");
  await updateStage(job.id, "FETCH_METADATA", { status: "done", detail: "Song identified from YouTube metadata" });
  await updateStage(job.id, "VALIDATE_AUDIO_SOURCE", {
    status: "done",
    detail: `Authorized audio received via UserUploadAudioProvider (${probe.durationSec.toFixed(1)}s, ${probe.codec ?? "unknown codec"})`,
  });
  await getQueueProvider().enqueue(job.id);
  return { reused: false, jobId: job.id };
}

async function cloneProcessedResults(fromSongId: string, toSongId: string): Promise<void> {
  const [assets, lines, sections, notes, difficult, source] = await Promise.all([
    prisma.audioAsset.findMany({ where: { songId: fromSongId } }),
    prisma.lyricLine.findMany({ where: { songId: fromSongId }, include: { words: true } }),
    prisma.songSection.findMany({ where: { songId: fromSongId } }),
    prisma.melodyNote.findMany({ where: { songId: fromSongId } }),
    prisma.difficultPart.findMany({ where: { songId: fromSongId } }),
    prisma.song.findUniqueOrThrow({ where: { id: fromSongId } }),
  ]);

  for (const asset of assets) {
    if (asset.kind === "original_upload") continue;
    await prisma.audioAsset.create({
      data: {
        songId: toSongId,
        kind: asset.kind,
        storageKey: asset.storageKey,
        mimeType: asset.mimeType,
        durationSec: asset.durationSec,
        sizeBytes: asset.sizeBytes,
        providerName: asset.providerName,
      },
    });
  }
  for (const line of lines) {
    await prisma.lyricLine.create({
      data: {
        songId: toSongId,
        index: line.index,
        start: line.start,
        end: line.end,
        sectionId: line.sectionId,
        words: { create: line.words.map((w) => ({ index: w.index, text: w.text, start: w.start, end: w.end, confidence: w.confidence })) },
      },
    });
  }
  for (const section of sections) {
    await prisma.songSection.create({
      data: { songId: toSongId, type: section.type, label: section.label, start: section.start, end: section.end, confidence: section.confidence, isEstimated: section.isEstimated },
    });
  }
  for (const note of notes) {
    await prisma.melodyNote.create({
      data: { songId: toSongId, start: note.start, end: note.end, midi: note.midi, noteName: note.noteName, confidence: note.confidence, meanFrequencyHz: note.meanFrequencyHz },
    });
  }
  for (const part of difficult) {
    await prisma.difficultPart.create({
      data: { songId: toSongId, start: part.start, end: part.end, reason: part.reason, detail: part.detail, severity: part.severity },
    });
  }

  await prisma.song.update({
    where: { id: toSongId },
    data: { vocalRangeJson: source.vocalRangeJson, keyEstimateJson: source.keyEstimateJson, language: source.language },
  });

  const job = await createProcessingJob(toSongId, "user_upload");
  const { updateStage } = await import("./jobService");
  for (const name of [
    "FETCH_METADATA",
    "VALIDATE_AUDIO_SOURCE",
    "PREPARE_AUDIO",
    "SEPARATE_STEMS",
    "TRANSCRIBE",
    "ALIGN_WORDS",
    "DETECT_PITCH",
    "SIMPLIFY_MELODY",
    "SEGMENT_LYRICS",
    "GENERATE_WAVEFORM",
    "BUILD_KARAOKE",
    "COMPLETE",
  ]) {
    await updateStage(job.id, name, { status: "done", detail: "Reused cached result for identical audio" });
  }
}

export async function assembleSongDTO(songId: string, clientOwnerId: string | null): Promise<SongDTO> {
  const song = await prisma.song.findUniqueOrThrow({
    where: { id: songId },
    include: {
      source: true,
      job: true,
      sections: { orderBy: { start: "asc" } },
      lines: { orderBy: { index: "asc" }, include: { words: { orderBy: { index: "asc" } } } },
      melodyNotes: { orderBy: { start: "asc" } },
      difficultParts: { orderBy: { start: "asc" } },
      assets: true,
    },
  });

  if (clientOwnerId && song.clientOwnerId !== clientOwnerId) {
    throw Object.assign(new Error("Not authorized to view this song"), { statusCode: 403 });
  }

  const storage = getStorageProvider();

  const referenceAsset = song.assets.find((a) => a.kind === "prepared_reference") ?? song.assets.find((a) => a.kind === "original_upload");
  const vocalsAsset = song.assets.find((a) => a.kind === "vocals");
  const instrumentalAsset = song.assets.find((a) => a.kind === "instrumental");
  const pitchAsset = song.assets.find((a) => a.kind === "pitch_frames_json");
  const waveformAsset = song.assets.find((a) => a.kind === "waveform_json");

  const assets: AudioAssetsDTO = {
    reference: referenceAsset ? await storage.getSignedUrl(referenceAsset.storageKey) : null,
    vocals: vocalsAsset ? await storage.getSignedUrl(vocalsAsset.storageKey) : null,
    instrumental: instrumentalAsset ? await storage.getSignedUrl(instrumentalAsset.storageKey) : null,
    separationAvailable: Boolean(vocalsAsset && instrumentalAsset),
    separationEngine: vocalsAsset?.providerName ?? null,
  };

  let pitchOverview: PitchPointDTO[] = [];
  if (pitchAsset) {
    try {
      const raw = await storage.getObject(pitchAsset.storageKey);
      const frames = JSON.parse(raw.toString("utf-8")) as PitchPointDTO[];
      pitchOverview = downsamplePitchPoints(frames, PITCH_OVERVIEW_MAX_POINTS);
    } catch {
      pitchOverview = [];
    }
  }

  let waveform = null;
  if (waveformAsset) {
    try {
      const raw = await storage.getObject(waveformAsset.storageKey);
      waveform = JSON.parse(raw.toString("utf-8"));
    } catch {
      waveform = null;
    }
  }

  const job = song.job ? await toJobDTO(song.job.id) : null;

  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    thumbnailUrl: song.thumbnailUrl,
    durationSec: song.durationSec,
    language: song.language,
    languageIsUserOverride: song.languageIsUserOverride,
    source: {
      youtubeVideoId: song.source?.youtubeVideoId ?? null,
      youtubeUrl: song.source?.youtubeUrl ?? null,
      title: song.title,
      channelTitle: song.source?.channelTitle ?? null,
      thumbnailUrl: song.source?.sourceThumbnailUrl ?? null,
      durationSec: song.source?.sourceDurationSec ?? null,
    },
    sections: song.sections.map((s) => ({
      id: s.id,
      type: s.type as SongDTO["sections"][number]["type"],
      label: s.label,
      start: s.start,
      end: s.end,
      confidence: s.confidence,
      isEstimated: s.isEstimated,
    })),
    lines: song.lines.map((line) => ({
      id: line.id,
      index: line.index,
      start: line.start,
      end: line.end,
      sectionId: line.sectionId,
      words: line.words.map((w) => ({
        id: w.id,
        text: w.text,
        start: w.start,
        end: w.end,
        confidence: w.confidence,
        isUserCorrected: w.isUserCorrected,
        lowConfidence: w.confidence < LOW_CONFIDENCE_THRESHOLD,
      })),
    })),
    melodyNotes: song.melodyNotes.map((n) => ({
      id: n.id,
      start: n.start,
      end: n.end,
      midi: n.midi,
      noteName: n.noteName,
      confidence: n.confidence,
      meanFrequencyHz: n.meanFrequencyHz,
    })),
    pitchOverview,
    difficultParts: song.difficultParts.map((d) => ({
      id: d.id,
      start: d.start,
      end: d.end,
      reason: d.reason as SongDTO["difficultParts"][number]["reason"],
      detail: d.detail,
      severity: d.severity,
    })),
    vocalRange: song.vocalRangeJson ? JSON.parse(song.vocalRangeJson) : null,
    keyEstimate: song.keyEstimateJson ? JSON.parse(song.keyEstimateJson) : null,
    waveform,
    assets,
    processingJob: job ?? {
      id: "",
      songId: song.id,
      status: "queued",
      stages: [],
      createdAt: song.createdAt.toISOString(),
      updatedAt: song.updatedAt.toISOString(),
    },
    createdAt: song.createdAt.toISOString(),
  };
}

export async function listSongsForClient(clientOwnerId: string) {
  return prisma.song.findMany({
    where: { clientOwnerId },
    orderBy: { createdAt: "desc" },
    include: { job: true, source: true },
  });
}
