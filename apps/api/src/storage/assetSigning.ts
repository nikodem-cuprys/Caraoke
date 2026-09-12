import crypto from "node:crypto";

const SECRET = process.env.ASSET_SIGNING_SECRET || "dev-asset-signing-secret-change-me";

function sign(key: string, exp: number): string {
  return crypto.createHmac("sha256", SECRET).update(`${key}:${exp}`).digest("hex");
}

/** Build a time-limited signed path for the local static asset route (used by LocalFilesystemStorageProvider). */
export function signAssetPath(key: string, expiresInSec: number): string {
  const exp = Math.floor(Date.now() / 1000) + expiresInSec;
  const sig = sign(key, exp);
  return `/assets/${key}?exp=${exp}&sig=${sig}`;
}

export function verifyAssetSignature(key: string, exp: string | undefined, sig: string | undefined): boolean {
  if (!exp || !sig) return false;
  const expNum = parseInt(exp, 10);
  if (!Number.isFinite(expNum) || expNum < Math.floor(Date.now() / 1000)) return false;
  const expected = sign(key, expNum);
  if (expected.length !== sig.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}
