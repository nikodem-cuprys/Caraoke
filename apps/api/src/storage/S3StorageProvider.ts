import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StorageProvider } from "./StorageProvider";

/**
 * Production storage provider backed by any S3-compatible object store
 * (AWS S3, or the MinIO container in infra/docker-compose.yml). Objects are
 * private by default; browsers receive short-lived signed URLs rather than
 * public links, per the privacy/security requirements.
 */
export class S3StorageProvider implements StorageProvider {
  private client: S3Client;

  constructor(
    private readonly bucket: string,
    options: { endpoint?: string; region?: string; forcePathStyle?: boolean } = {}
  ) {
    this.client = new S3Client({
      region: options.region ?? "us-east-1",
      endpoint: options.endpoint,
      forcePathStyle: options.forcePathStyle ?? true,
    });
  }

  async putObject(key: string, data: Buffer, contentType?: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType })
    );
    return key;
  }

  async getObject(key: string): Promise<Buffer> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const chunks: Buffer[] = [];
    for await (const chunk of result.Body as AsyncIterable<Buffer>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  resolveLocalPath(): string {
    throw new Error(
      "S3StorageProvider has no local filesystem path. The worker must download via a signed URL into a temp file for the object-storage deployment mode (see README: Worker Configuration)."
    );
  }

  async getSignedUrl(key: string, expiresInSec = 3600): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSec,
    });
  }

  async getUploadUrl(key: string, contentType: string, expiresInSec = 3600): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn: expiresInSec }
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
