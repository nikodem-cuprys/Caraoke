/**
 * Job queue abstraction. The Python worker never talks to Redis or the
 * database directly — it only calls the `/internal/queue/*` HTTP endpoints
 * (see routes/worker.ts), which delegate "what job is next" to whichever
 * QueueProvider is configured. That keeps the worker-facing contract
 * identical regardless of which provider backs it, and keeps worker
 * credentials limited to a single shared secret rather than DB/Redis access.
 */
export interface QueueProvider {
  readonly name: string;
  /** Mark a job as ready to be claimed by a worker. */
  enqueue(jobId: string): Promise<void>;
  /** Atomically claim the next eligible job, respecting maxConcurrentJobs. Returns null if none available. */
  claimNext(): Promise<string | null>;
  /** Release a claimed job's concurrency slot after it finishes (success or failure). */
  release(jobId: string): Promise<void>;
}
