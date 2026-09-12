import { parseYoutubeUrl } from "@singlearn/shared";
import { config } from "../config";

export interface YoutubeMetadata {
  videoId: string;
  canonicalUrl: string;
  title: string;
  authorName: string | null;
  thumbnailUrl: string | null;
}

export class YoutubeMetadataError extends Error {}

/**
 * Fetches public oEmbed metadata for a YouTube video (title, channel name,
 * thumbnail). oEmbed does not return duration; if it becomes required we can
 * add the official YouTube Data API v3 `videos.list` call using an API key,
 * gated on YOUTUBE_DATA_API_KEY being set. Only ever called with a URL
 * re-derived from a validated 11-char video ID (see parseYoutubeUrl) —
 * never with a raw user-supplied string — to prevent SSRF.
 */
export async function fetchYoutubeMetadata(rawUrl: string): Promise<YoutubeMetadata> {
  const { videoId, canonicalUrl } = parseYoutubeUrl(rawUrl);

  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.youtubeOembedTimeoutMs);
  try {
    const response = await fetch(oembedUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new YoutubeMetadataError(
        response.status === 404
          ? "Video not found or not embeddable/public"
          : `YouTube oEmbed request failed with status ${response.status}`
      );
    }
    const data = (await response.json()) as {
      title?: string;
      author_name?: string;
      thumbnail_url?: string;
    };
    return {
      videoId,
      canonicalUrl,
      title: data.title ?? "Untitled",
      authorName: data.author_name ?? null,
      thumbnailUrl: data.thumbnail_url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    };
  } catch (err) {
    if (err instanceof YoutubeMetadataError) throw err;
    throw new YoutubeMetadataError(`Could not fetch YouTube metadata: ${(err as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }
}
