import { PROCESSING_STAGE_ORDER, type ProcessingJobDTO, type ProcessingStage, type StageStatus } from "@singlearn/shared";
import type { ProcessingJob, ProcessingStage as ProcessingStageRow } from "@prisma/client";
import { prisma } from "../db/client";
import { sseHub } from "./sse";

export async function createProcessingJob(songId: string, audioSourceKind: string): Promise<ProcessingJob> {
  const job = await prisma.processingJob.create({
    data: {
      songId,
      status: "queued",
      audioSourceKind,
      stages: {
        create: PROCESSING_STAGE_ORDER.map((name, order) => ({
          name,
          order,
          status: "pending" as StageStatus,
        })),
      },
    },
  });
  return job;
}

export function toStageDTO(row: ProcessingStageRow): ProcessingStage {
  return {
    name: row.name as ProcessingStage["name"],
    status: row.status as StageStatus,
    progress: row.progress,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    error: row.error,
    detail: row.detail,
  };
}

export async function toJobDTO(jobId: string): Promise<ProcessingJobDTO> {
  const job = await prisma.processingJob.findUniqueOrThrow({
    where: { id: jobId },
    include: { stages: { orderBy: { order: "asc" } } },
  });
  return {
    id: job.id,
    songId: job.songId,
    status: job.status as ProcessingJobDTO["status"],
    stages: job.stages.map(toStageDTO),
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

export interface StageUpdateInput {
  status: StageStatus;
  progress?: number | null;
  detail?: string | null;
  error?: string | null;
}

export async function updateStage(jobId: string, stageName: string, update: StageUpdateInput): Promise<void> {
  const now = new Date();
  await prisma.processingStage.updateMany({
    where: { jobId, name: stageName },
    data: {
      status: update.status,
      progress: update.progress ?? null,
      detail: update.detail ?? undefined,
      error: update.error ?? undefined,
      startedAt: update.status === "running" ? now : undefined,
      finishedAt: ["done", "failed", "skipped"].includes(update.status) ? now : undefined,
    },
  });

  if (update.status === "failed") {
    await prisma.processingJob.update({ where: { id: jobId }, data: { status: "failed" } });
  }
  if (stageName === "COMPLETE" && update.status === "done") {
    await prisma.processingJob.update({ where: { id: jobId }, data: { status: "complete" } });
  }

  const dto = await toJobDTO(jobId);
  sseHub.publish(jobId, "stage-update", dto);
}

export async function markJobFailed(jobId: string, error: string): Promise<void> {
  await prisma.processingJob.update({ where: { id: jobId }, data: { status: "failed" } });
  const dto = await toJobDTO(jobId);
  sseHub.publish(jobId, "stage-update", dto);
}
