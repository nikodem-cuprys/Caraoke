import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface AudioProbeResult {
  durationSec: number;
  codec: string | null;
  sampleRate: number | null;
}

export class UnsupportedAudioError extends Error {}

/** Probe an uploaded file with ffprobe. Never trust client-declared duration/mime type. */
export async function probeAudioFile(filePath: string): Promise<AudioProbeResult> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_name,sample_rate,codec_type",
      "-of",
      "json",
      filePath,
    ]);
    const parsed = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: { codec_type?: string; codec_name?: string; sample_rate?: string }[];
    };
    const audioStream = parsed.streams?.find((s) => s.codec_type === "audio");
    if (!audioStream) {
      throw new UnsupportedAudioError("Uploaded file does not contain a valid audio stream");
    }
    const durationSec = parseFloat(parsed.format?.duration ?? "0");
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      throw new UnsupportedAudioError("Could not determine audio duration");
    }
    return {
      durationSec,
      codec: audioStream.codec_name ?? null,
      sampleRate: audioStream.sample_rate ? parseInt(audioStream.sample_rate, 10) : null,
    };
  } catch (err) {
    if (err instanceof UnsupportedAudioError) throw err;
    throw new UnsupportedAudioError(`File is not readable as audio: ${(err as Error).message}`);
  }
}
