import path from "node:path";
import { config } from "../config";
import { LocalFilesystemStorageProvider } from "./LocalFilesystemStorageProvider";
import type { StorageProvider } from "./StorageProvider";

let instance: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (instance) return instance;

  let created: StorageProvider;
  if (config.storageProvider === "s3") {
    // Imported lazily so local dev never needs the aws-sdk packages resolved.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { S3StorageProvider } = require("./S3StorageProvider");
    const bucket = process.env.S3_BUCKET;
    if (!bucket) throw new Error("S3_BUCKET is required when STORAGE_PROVIDER=s3");
    created = new S3StorageProvider(bucket, {
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    });
  } else {
    created = new LocalFilesystemStorageProvider(path.resolve(config.storageLocalRoot), config.apiPublicUrl);
  }
  instance = created;
  return created;
}

export type { StorageProvider } from "./StorageProvider";
