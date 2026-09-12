/**
 * YouTube URL validation. This is intentionally an allowlist parser, not a
 * generic URL fetcher: it only ever extracts an 11-character video ID from a
 * small set of known-good hostnames/path shapes. Callers must never pass an
 * arbitrary user-supplied URL to an HTTP client — always re-derive a fresh
 * https://www.youtube.com/watch?v=<id> (or oEmbed) URL from the validated ID.
 * This prevents SSRF via a malicious "youtube.com.evil.tld" or open-redirect
 * style URL.
 */

const ALLOWED_HOSTS = new Set([
  "www.youtube.com",
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
]);

const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

export interface ParsedYoutubeUrl {
  videoId: string;
  canonicalUrl: string;
}

export class InvalidYoutubeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidYoutubeUrlError";
  }
}

export function parseYoutubeUrl(input: string): ParsedYoutubeUrl {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new InvalidYoutubeUrlError("Not a valid URL");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new InvalidYoutubeUrlError("URL must use http or https");
  }

  const host = url.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) {
    throw new InvalidYoutubeUrlError(`Unsupported host: ${host}`);
  }

  let videoId: string | null = null;

  if (host === "youtu.be") {
    videoId = url.pathname.replace(/^\//, "").split("/")[0] ?? null;
  } else if (url.pathname === "/watch") {
    videoId = url.searchParams.get("v");
  } else if (url.pathname.startsWith("/shorts/")) {
    videoId = url.pathname.split("/")[2] ?? null;
  } else if (url.pathname.startsWith("/embed/")) {
    videoId = url.pathname.split("/")[2] ?? null;
  } else if (url.pathname.startsWith("/live/")) {
    videoId = url.pathname.split("/")[2] ?? null;
  }

  if (!videoId || !VIDEO_ID_RE.test(videoId)) {
    throw new InvalidYoutubeUrlError("Could not find a valid 11-character video ID in URL");
  }

  return {
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

export function isValidYoutubeUrl(input: string): boolean {
  try {
    parseYoutubeUrl(input);
    return true;
  } catch {
    return false;
  }
}
