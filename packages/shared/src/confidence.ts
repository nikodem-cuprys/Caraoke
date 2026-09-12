/**
 * Below this confidence, transcription/alignment/pitch/section output is
 * flagged in the UI as a possible error instead of being presented as fact.
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.5;

export function isLowConfidence(confidence: number): boolean {
  return confidence < LOW_CONFIDENCE_THRESHOLD;
}
