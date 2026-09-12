import { Queue } from "bullmq";
import IORedis from "ioredis";
import { config } from "../config";
import { prisma } from "../db/client";
import type { QueueProvider } from "./QueueProvider";

/**
 * Production queue provider. Requires REDIS_URL and QUEUE_PROVIDER=bullmq.
 * BullMQ gives us retry/backoff and a dashboard-friendly queue for scaling
 * to multiple worker machines/GPUs; the worker-facing HTTP contract in
 * routes/worker.ts is unchanged, so switching providers is purely an API
 * configuration change (see README: "Worker Configuration").
 *
 * Not exercised in this repository's automated tests because they run
 * without Redis available; DbBackedQueueProvider is the default and the one
 * covered by integration tests.
 */
export class BullMqQueueProvider implements QueueProvider {
  readonly name = "bullmq";
  private queue: Queue;
  private connection: IORedis;

  constructor(redisUrl: string) {
    this.connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue("singlearn-processing", { connection: this.connection });
  }

  async enqueue(jobId: string): Promise<void> {
    await prisma.processingJob.update({ where: { id: jobId }, data: { status: "queued" } });
    await this.queue.add("process-song", { jobId }, { jobId, removeOnComplete: true, removeOnFail: false });
  }

  async claimNext(): Promise<string | null> {
    const runningCount = await prisma.processingJob.count({ where: { status: "running" } });
    if (runningCount >= config.maxConcurrentJobs) return null;

    const waiting = await this.queue.getWaiting(0, 0);
    const candidate = waiting[0];
    if (!candidate) return null;

    const claimed = await prisma.processingJob.updateMany({
      where: { id: candidate.data.jobId, status: "queued" },
      data: { status: "running" },
    });
    if (claimed.count === 0) return null;
    await candidate.remove();
    return candidate.data.jobId as string;
  }

  async release(): Promise<void> {
    // BullMQ concurrency is enforced via the running-count check above.
  }
}
