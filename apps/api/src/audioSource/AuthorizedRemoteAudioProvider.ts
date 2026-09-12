import type { AudioSourceProvider, AudioSourceRequest, AudioSourceResolution } from "./AudioSourceProvider";

/**
 * Extension point for a deployment-specific integration where the operator
 * has obtained explicit, verifiable rights to fetch audio for particular
 * content server-side (e.g. a direct agreement with a rights holder, or a
 * licensed distribution API) — this is deliberately NOT a generic
 * "download from YouTube" adapter, which YouTube's terms prohibit, and this
 * class must never be implemented that way. It is disabled by default via
 * the `AUTHORIZED_REMOTE_AUDIO_ENABLED` env flag; enabling it without an
 * actual authorized backend wired into `resolve()` has no effect beyond
 * this stub.
 */
export class AuthorizedRemoteAudioProvider implements AudioSourceProvider {
  readonly name = "AuthorizedRemoteAudioProvider";

  isConfigured(): boolean {
    return process.env.AUTHORIZED_REMOTE_AUDIO_ENABLED === "true";
  }

  async resolve(_request: AudioSourceRequest): Promise<AudioSourceResolution> {
    return {
      status: "needs_user_upload",
      reason: "No authorized remote audio integration is configured in this deployment.",
    };
  }
}
