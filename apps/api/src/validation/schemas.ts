import { z } from "zod";

export const createSongSchema = z.object({
  youtubeUrl: z.string().min(1).max(2048),
});

export const correctWordSchema = z.object({
  wordId: z.string().min(1),
  text: z.string().min(0).max(200),
});

export const editSectionSchema = z.object({
  type: z.enum(["intro", "verse", "pre_chorus", "chorus", "bridge", "outro", "instrumental", "unknown"]).optional(),
  label: z.string().min(1).max(80).optional(),
  start: z.number().min(0).optional(),
  end: z.number().min(0).optional(),
});

export const languageOverrideSchema = z.object({
  language: z.string().min(2).max(10),
});

export const stageUpdateSchema = z.object({
  name: z.enum([
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
  ]),
  status: z.enum(["pending", "running", "done", "failed", "skipped"]),
  progress: z.number().min(0).max(1).nullable().optional(),
  detail: z.string().max(2000).nullable().optional(),
  error: z.string().max(4000).nullable().optional(),
});

export const submitLyricsSchema = z.object({
  language: z.string().min(2).max(10),
  languageConfidence: z.number().min(0).max(1),
  lines: z.array(
    z.object({
      start: z.number().min(0),
      end: z.number().min(0),
      words: z.array(
        z.object({
          text: z.string().min(1),
          start: z.number().min(0),
          end: z.number().min(0),
          confidence: z.number().min(0).max(1),
        })
      ),
    })
  ),
});

export const submitMelodySchema = z.object({
  notes: z.array(
    z.object({
      start: z.number().min(0),
      end: z.number().min(0),
      midi: z.number(),
      noteName: z.string(),
      confidence: z.number().min(0).max(1),
      meanFrequencyHz: z.number().positive(),
    })
  ),
  vocalRange: z
    .object({
      lowestMidi: z.number(),
      highestMidi: z.number(),
      lowestNote: z.string(),
      highestNote: z.string(),
      semitoneRange: z.number(),
      sampleCount: z.number(),
    })
    .nullable(),
  keyEstimate: z
    .object({
      tonic: z.string(),
      mode: z.enum(["major", "minor"]),
      confidence: z.number().min(0).max(1),
    })
    .nullable(),
  difficultParts: z.array(
    z.object({
      start: z.number().min(0),
      end: z.number().min(0),
      reason: z.enum(["large_interval_jump", "highest_note", "lowest_note", "long_sustain", "rapid_melodic_change"]),
      detail: z.string(),
      severity: z.number().min(0).max(1),
    })
  ),
});

export const submitSectionsSchema = z.object({
  sections: z.array(
    z.object({
      type: z.enum(["intro", "verse", "pre_chorus", "chorus", "bridge", "outro", "instrumental", "unknown"]),
      label: z.string(),
      start: z.number().min(0),
      end: z.number().min(0),
      confidence: z.number().min(0).max(1),
      isEstimated: z.boolean(),
    })
  ),
});
