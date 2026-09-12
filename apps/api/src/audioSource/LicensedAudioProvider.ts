import type { AudioSourceProvider, AudioSourceRequest, AudioSourceResolution } from "./AudioSourceProvider";

/**
 * Extension point for a properly licensed audio catalog/partner API (for
 * example a sync-licensing service that has granted rights to serve
 * processable audio for identified tracks). No such partner is integrated
 * in this codebase — wiring one up means implementing `resolve()` to call
 * the partner API with the matched song identity and storing the returned
 * bytes as an `original_upload`-equivalent AudioAsset. Until then this
 * provider always reports itself unconfigured so the resolver falls through
 * to the next provider (ultimately UserUploadAudioProvider).
 */
export class LicensedAudioProvider implements AudioSourceProvider {
  readonly name = "LicensedAudioProvider";

  isConfigured(): boolean {
    return false;
  }

  async resolve(_request: AudioSourceRequest): Promise<AudioSourceResolution> {
    return {
      status: "needs_user_upload",
      reason: "No licensed audio provider is configured in this deployment.",
    };
  }
}
