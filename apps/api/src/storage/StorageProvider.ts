/**
 * Storage abstraction for audio assets and derived artifacts (stems,
 * pitch-frame JSON, waveform JSON). Two implementations are provided:
 *
 *  - LocalFilesystemStorageProvider: default for local development so the
 *    whole stack runs without any external infrastructure.
 *  - S3StorageProvider: for production/deployment, backed by any
 *    S3-compatible store (AWS S3 or a self-hosted MinIO, per the
 *    docker-compose in infra/). Signed URLs keep private assets from being
 *    exposed publicly by default.
 *
 * The rest of the application only depends on this interface, so the
 * backing store can be swapped without touching pipeline or route code.
 */
export interface StorageProvider {
  /** Write a buffer to the given key, returning the key (unchanged) for convenience. */
  putObject(key: string, data: Buffer, contentType?: string): Promise<string>;

  /** Read an object fully into memory. Only used for small JSON artifacts. */
  getObject(key: string): Promise<Buffer>;

  /** Absolute filesystem path (local provider) — used by the worker for ffmpeg/ML I/O. */
  resolveLocalPath(key: string): string;

  /** A URL the browser can use to fetch/stream the object directly. */
  getSignedUrl(key: string, expiresInSec?: number): Promise<string>;

  /**
   * A time-limited URL a caller can PUT raw bytes to, to write an object
   * without going through this process. Used by the worker to upload the
   * files it produces (stems, prepared audio, pitch/waveform JSON) when it
   * has no filesystem in common with the API — i.e. only meaningful for
   * remote object storage; the local provider has no use for it, since the
   * worker writes directly into the shared storage root instead.
   */
  getUploadUrl(key: string, contentType: string, expiresInSec?: number): Promise<string>;

  exists(key: string): Promise<boolean>;

  deleteObject(key: string): Promise<void>;
}
