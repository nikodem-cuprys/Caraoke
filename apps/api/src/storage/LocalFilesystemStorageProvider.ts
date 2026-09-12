import fs from "node:fs";
import path from "node:path";
import type { StorageProvider } from "./StorageProvider";
import { signAssetPath } from "./assetSigning";

/**
 * Default dev/no-Docker storage provider: stores objects on the local
 * filesystem under STORAGE_LOCAL_ROOT. Both the API process and the Python
 * worker process run on the same machine in this mode and share that root,
 * so the worker can operate on files directly instead of downloading them.
 */
export class LocalFilesystemStorageProvider implements StorageProvider {
  constructor(private readonly root: string, private readonly publicBaseUrl: string) {
    fs.mkdirSync(root, { recursive: true });
  }

  private fullPath(key: string): string {
    const normalized = path.normalize(key).replace(/^([./\\]+)/, "");
    const resolved = path.join(this.root, normalized);
    const resolvedRoot = path.resolve(this.root);
    if (!path.resolve(resolved).startsWith(resolvedRoot)) {
      throw new Error(`Refusing to access storage key outside root: ${key}`);
    }
    return resolved;
  }

  async putObject(key: string, data: Buffer): Promise<string> {
    const full = this.fullPath(key);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, data);
    return key;
  }

  async getObject(key: string): Promise<Buffer> {
    return fs.readFileSync(this.fullPath(key));
  }

  resolveLocalPath(key: string): string {
    return this.fullPath(key);
  }

  async getSignedUrl(key: string, expiresInSec = 3600): Promise<string> {
    // Time-limited HMAC-signed path served by the /assets route in app.ts.
    // Plain <audio>/<img> tags can't send custom auth headers, so the
    // signature travels in the query string instead (mirroring how S3
    // presigned URLs work) rather than exposing the object publicly.
    // Absolute (not host-relative) so it resolves correctly for callers on a
    // different origin than the API itself, e.g. the browser's web app dev
    // server or the worker process.
    return `${this.publicBaseUrl}${signAssetPath(key, expiresInSec)}`;
  }

  async getUploadUrl(): Promise<string> {
    throw new Error(
      "LocalFilesystemStorageProvider has no upload-URL concept: the API and worker share this filesystem " +
        "directly, so the worker writes finished assets straight into the storage root instead of uploading them."
    );
  }

  async exists(key: string): Promise<boolean> {
    return fs.existsSync(this.fullPath(key));
  }

  async deleteObject(key: string): Promise<void> {
    const full = this.fullPath(key);
    if (fs.existsSync(full)) fs.unlinkSync(full);
  }
}
