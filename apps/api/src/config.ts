import "dotenv/config";

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: optionalNumber("PORT", 4000),
  storageProvider: (process.env.STORAGE_PROVIDER ?? "local") as "local" | "s3",
  storageLocalRoot: requireEnv("STORAGE_LOCAL_ROOT", "./storage_data"),
  // Absolute origin the API is reachable at, used to turn the local storage
  // provider's signed asset paths into absolute URLs. Browsers and the
  // worker process resolve relative URLs against their own origin (the web
  // app's dev server, in local dev), not the API's, so a bare path like
  // `/assets/...` silently 404s unless this is set to the API's own origin.
  apiPublicUrl: (process.env.API_PUBLIC_URL || `http://localhost:${optionalNumber("PORT", 4000)}`).replace(/\/$/, ""),
  queueProvider: (process.env.QUEUE_PROVIDER ?? "db") as "db" | "bullmq",
  redisUrl: process.env.REDIS_URL || null,
  workerSharedSecret: requireEnv("WORKER_SHARED_SECRET", "dev-worker-secret-change-me"),
  maxUploadMb: optionalNumber("MAX_UPLOAD_MB", 60),
  maxSongDurationSec: optionalNumber("MAX_SONG_DURATION_SEC", 480),
  maxConcurrentJobs: optionalNumber("MAX_CONCURRENT_JOBS", 2),
  corsOrigin: (process.env.CORS_ORIGIN ?? "http://localhost:3200").split(",").map((s) => s.trim()),
  youtubeOembedTimeoutMs: optionalNumber("YOUTUBE_OEMBED_TIMEOUT_MS", 8000),
  separationEngine: process.env.SEPARATION_ENGINE ?? "demucs",
};
