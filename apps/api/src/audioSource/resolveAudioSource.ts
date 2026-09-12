import { AuthorizedRemoteAudioProvider } from "./AuthorizedRemoteAudioProvider";
import type { AudioSourceRequest, AudioSourceResolution } from "./AudioSourceProvider";
import { LicensedAudioProvider } from "./LicensedAudioProvider";
import { UserUploadAudioProvider } from "./UserUploadAudioProvider";

const providers = [new LicensedAudioProvider(), new AuthorizedRemoteAudioProvider(), new UserUploadAudioProvider()];

/** Try each configured audio source provider in priority order, falling back to asking the user to upload. */
export async function resolveAudioSource(request: AudioSourceRequest): Promise<AudioSourceResolution> {
  for (const provider of providers) {
    if (!provider.isConfigured()) continue;
    const result = await provider.resolve(request);
    if (result.status === "ready") return result;
  }
  // Always fall through to the upload provider's answer even if unconfigured
  // providers were skipped, so the caller gets a concrete reason.
  return new UserUploadAudioProvider().resolve(request);
}
