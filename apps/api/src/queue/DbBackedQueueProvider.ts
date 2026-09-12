import { prisma } from "../db/client";
import { config } from "../config";
import type { QueueProvider } from "./QueueProvider";

/**
 * Default dev/no-Redis queue: the ProcessingJob table itself is the queue
 * ("database as queue" pattern). This is intentionally simple and adequate
 * for the single-node MVP; see BullMqQueueProvider for the production path
 * with retries/backoff/distributed workers once Redis is available.
 */
export class DbBackedQueueProvider implements QueueProvider {
  readonly name = "db";

  async enqueue(jobId: string): Promise<void> {
    await prisma.processingJob.update({ where: { id: jobId }, data: { status: "queued" } });
  }

  async claimNext(): Promise<string | null> {
    const runningCount = await prisma.processingJob.count({ where: { status: "running" } });
    if (runningCount >= config.maxConcurrentJobs) return null;

    const next = await prisma.processingJob.findFirst({
      where: { status: "queued" },
      orderBy: { createdAt: "asc" },
    });
    if (!next) return null;

    // Optimistic claim: only succeeds if still queued (avoids double-claim
    // races between concurrent worker polls).
    const claimed = await prisma.processingJob.updateMany({
      where: { id: next.id, status: "queued" },
      data: { status: "running" },
    });
    if (claimed.count === 0) return null;
    return next.id;
  }

  async release(): Promise<void> {
    // No-op: DbBackedQueueProvider derives concurrency purely from the
    // `status = running` count, which jobService already clears to
    // complete/failed when a job finishes.
  }
}
