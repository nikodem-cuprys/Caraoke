/**
 * Audio sourcing is the one place in this system where legal/platform
 * constraints are non-negotiable: YouTube's API Services Terms of Service
 * explicitly forbid using the API (or any other means) to download, extract,
 * or separate the audio/video tracks of a YouTube video
 * (developers.google.com/youtube/terms/developer-policies). SingLearn never
 * attempts to circumvent that. A YouTube URL is only ever used to identify
 * the song (title/artist/thumbnail/duration via oEmbed) and to embed the
 * official player for reference playback.
 *
 * To actually run the audio pipeline (separation/transcription/pitch), the
 * system needs bytes it is authorized to process. That authorization is
 * modeled behind this interface so the rest of the app (queue, pipeline,
 * player) never needs to know or care where the audio came from.
 *
 * Implementations, in the order the default resolver tries them:
 *   1. LicensedAudioProvider        - a properly licensed content partner
 *                                     (not configured out of the box; see
 *                                     class docstring).
 *   2. AuthorizedRemoteAudioProvider - an operator-specific integration for
 *                                     which explicit rights were obtained
 *                                     (disabled by default; never a generic
 *                                     YouTube-downloader).
 *   3. UserUploadAudioProvider      - the user supplies audio they own or
 *                                     have permission to process. This is
 *                                     the only provider enabled by default.
 */
export interface AudioSourceRequest {
  songId: string;
  youtubeVideoId: string | null;
}

export type AudioSourceResolution =
  | { status: "ready"; storageKey: string; sizeBytes: number; providerName: string; mimeType: string }
  | { status: "needs_user_upload"; reason: string };

export interface AudioSourceProvider {
  readonly name: string;
  isConfigured(): boolean;
  resolve(request: AudioSourceRequest): Promise<AudioSourceResolution>;
}
