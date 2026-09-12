/**
 * Canonical SingLearn data model.
 *
 * This is the single source of truth for the song/timeline shape shared
 * between the API, the web player, and (mirrored as Python dataclasses)
 * the worker pipeline. All playback-driven UI (word highlighting, pitch
 * scrolling, section indicator) must derive from ONE canonical time value
 * expressed in seconds from the start of the reference track.
 */

export type ProcessingStageName =
  | "FETCH_METADATA"
  | "VALIDATE_AUDIO_SOURCE"
  | "PREPARE_AUDIO"
  | "SEPARATE_STEMS"
  | "TRANSCRIBE"
  | "ALIGN_WORDS"
  | "DETECT_PITCH"
  | "SIMPLIFY_MELODY"
  | "SEGMENT_LYRICS"
  | "GENERATE_WAVEFORM"
  | "BUILD_KARAOKE"
  | "COMPLETE";

export const PROCESSING_STAGE_ORDER: ProcessingStageName[] = [
  "FETCH_METADATA",
  "VALIDATE_AUDIO_SOURCE",
  "PREPARE_AUDIO",
  "SEPARATE_STEMS",
  "TRANSCRIBE",
  "ALIGN_WORDS",
  "DETECT_PITCH",
  "SIMPLIFY_MELODY",
  "SEGMENT_LYRICS",
  "GENERATE_WAVEFORM",
  "BUILD_KARAOKE",
  "COMPLETE",
];

export type StageStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface ProcessingStage {
  name: ProcessingStageName;
  status: StageStatus;
  progress: number | null; // 0..1 real progress if the stage reports one, else null
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  detail: string | null;
}

export type JobStatus = "queued" | "running" | "complete" | "failed";

export interface ProcessingJobDTO {
  id: string;
  songId: string;
  status: JobStatus;
  stages: ProcessingStage[];
  createdAt: string;
  updatedAt: string;
}

export type AudioSourceKind = "user_upload" | "licensed" | "authorized_remote";

export interface SourceReferenceDTO {
  youtubeVideoId: string | null;
  youtubeUrl: string | null;
  title: string;
  channelTitle: string | null;
  thumbnailUrl: string | null;
  durationSec: number | null;
}

export interface LyricWordDTO {
  id: string;
  text: string;
  start: number;
  end: number;
  confidence: number;
  isUserCorrected: boolean;
  lowConfidence: boolean;
}

export interface LyricLineDTO {
  id: string;
  index: number;
  start: number;
  end: number;
  sectionId: string | null;
  words: LyricWordDTO[];
}

export type SectionType =
  | "intro"
  | "verse"
  | "pre_chorus"
  | "chorus"
  | "bridge"
  | "outro"
  | "instrumental"
  | "unknown";

export interface SongSectionDTO {
  id: string;
  type: SectionType;
  label: string;
  start: number;
  end: number;
  confidence: number;
  isEstimated: boolean;
}

/** A single downsampled pitch observation used for display. */
export interface PitchPointDTO {
  t: number; // seconds
  frequencyHz: number | null; // null when unvoiced / below confidence threshold
  midi: number | null;
  confidence: number;
  voiced: boolean;
}

export interface MelodyNoteDTO {
  id: string;
  start: number;
  end: number;
  midi: number; // rounded target semitone
  noteName: string; // e.g. "C#4"
  confidence: number;
  meanFrequencyHz: number;
}

export type DifficultPartReason =
  | "large_interval_jump"
  | "highest_note"
  | "lowest_note"
  | "long_sustain"
  | "rapid_melodic_change";

export interface DifficultPartDTO {
  id: string;
  start: number;
  end: number;
  reason: DifficultPartReason;
  detail: string;
  severity: number; // 0..1, estimate not certainty
}

export interface VocalRangeDTO {
  lowestMidi: number;
  highestMidi: number;
  lowestNote: string;
  highestNote: string;
  semitoneRange: number;
  sampleCount: number;
}

export interface KeyEstimateDTO {
  tonic: string; // e.g. "E"
  mode: "major" | "minor";
  confidence: number;
}

export interface WaveformDTO {
  sampleRateHz: number; // effective rate of the peaks array (peaks per second)
  peaks: number[]; // 0..1 normalized peak amplitude per bucket
  durationSec: number;
}

export interface AudioAssetsDTO {
  reference: string | null; // signed URL to prepared reference mix
  vocals: string | null; // signed URL to isolated vocal stem, if separation ran
  instrumental: string | null; // signed URL to instrumental stem, if separation ran
  separationAvailable: boolean;
  separationEngine: string | null;
}

export interface SongDTO {
  id: string;
  title: string;
  artist: string | null;
  thumbnailUrl: string | null;
  durationSec: number;
  language: string | null;
  languageIsUserOverride: boolean;
  source: SourceReferenceDTO;
  sections: SongSectionDTO[];
  lines: LyricLineDTO[];
  melodyNotes: MelodyNoteDTO[];
  pitchOverview: PitchPointDTO[]; // downsampled full-song contour for the overview view
  difficultParts: DifficultPartDTO[];
  vocalRange: VocalRangeDTO | null;
  keyEstimate: KeyEstimateDTO | null;
  waveform: WaveformDTO | null;
  assets: AudioAssetsDTO;
  processingJob: ProcessingJobDTO;
  createdAt: string;
}

export interface UserCorrectionInput {
  wordId: string;
  text: string;
}
