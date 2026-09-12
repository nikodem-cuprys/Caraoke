import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { getStorageProvider } from "../storage";
import { verifyAssetSignature } from "../storage/assetSigning";

export const assetsRouter = Router();

const CONTENT_TYPES: Record<string, string> = {
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".json": "application/json",
};

/** Streams a locally-stored asset, enforcing the signed exp/sig query params. Supports HTTP Range for audio scrubbing. */
assetsRouter.get("/*splat", async (req, res) => {
  const key = (req.params as unknown as { splat: string[] }).splat.join("/");
  if (!verifyAssetSignature(key, req.query.exp as string | undefined, req.query.sig as string | undefined)) {
    res.status(403).json({ error: "Invalid or expired asset link" });
    return;
  }

  const storage = getStorageProvider();
  let filePath: string;
  try {
    filePath = storage.resolveLocalPath(key);
  } catch {
    res.status(404).end();
    return;
  }
  if (!fs.existsSync(filePath)) {
    res.status(404).end();
    return;
  }

  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
  const range = req.headers.range;

  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    const start = match?.[1] ? parseInt(match[1], 10) : 0;
    const end = match?.[2] ? parseInt(match[2], 10) : stat.size - 1;
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
      "Content-Type": contentType,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Length": stat.size,
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
    });
    fs.createReadStream(filePath).pipe(res);
  }
});
