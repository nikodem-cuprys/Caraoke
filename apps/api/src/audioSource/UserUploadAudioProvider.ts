import { prisma } from "../db/client";
import type { AudioSourceProvider, AudioSourceRequest, AudioSourceResolution } from "./AudioSourceProvider";

/**
 * The default, always-enabled audio source: the user uploads a file they
 * own or otherwise have permission to process (see the upload validation in
 * routes/upload.ts for size/duration/type limits). This provider does not
 * fetch anything itself — it simply checks whether such an upload already
 * exists for the song and reports back so the processing pipeline knows
 * whether it can proceed or must pause and ask the user for a file.
 */
export class UserUploadAudioProvider implements AudioSourceProvider {
  readonly name = "UserUploadAudioProvider";

  isConfigured(): boolean {
    return true;
  }

  async resolve(request: AudioSourceRequest): Promise<AudioSourceResolution> {
    const asset = await prisma.audioAsset.findFirst({
      where: { songId: request.songId, kind: "original_upload" },
      orderBy: { createdAt: "desc" },
    });

    if (!asset) {
      return {
        status: "needs_user_upload",
        reason:
          "No authorized audio source is available yet. Please upload an audio file you own or have permission to process.",
      };
    }

    return {
      status: "ready",
      storageKey: asset.storageKey,
      sizeBytes: asset.sizeBytes ?? 0,
      providerName: this.name,
      mimeType: asset.mimeType ?? "application/octet-stream",
    };
  }
}
