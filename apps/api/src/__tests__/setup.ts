import fs from "node:fs";
import path from "node:path";

const testStorageRoot = path.join(__dirname, "..", "..", "storage_data_test");
fs.rmSync(testStorageRoot, { recursive: true, force: true });

process.env.DATABASE_URL = "file:./test.db";
process.env.STORAGE_LOCAL_ROOT = testStorageRoot;
process.env.WORKER_SHARED_SECRET = "test-worker-secret";
process.env.ASSET_SIGNING_SECRET = "test-asset-signing-secret";
process.env.MAX_SONG_DURATION_SEC = "480";
process.env.MAX_UPLOAD_MB = "60";
process.env.QUEUE_PROVIDER = "db";
process.env.NODE_ENV = "test";
