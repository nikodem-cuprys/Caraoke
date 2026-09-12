/**
 * Client-side (microphone) pitch detection. Pure signal processing over a
 * plain Float32Array so it runs anywhere (browser AnalyserNode buffer, or a
 * synthetic buffer in tests) without any Web Audio/DOM dependency here.
 *
 * Uses time-domain autocorrelation (the standard, dependency-free approach
 * for real-time monophonic pitch tracking of a single voice) rather than
 * the worker pipeline's librosa `pyin` - pyin is more accurate but far too
 * heavy to run per-frame in a browser tab. Same singing-voice frequency
 * range as the worker's DETECT_PITCH stage (see
 * apps/worker/singlearn_worker/pipeline/detect_pitch.py) for consistency
 * between the two pitch sources being compared.
 */

const DEFAULT_FMIN_HZ = 65; // ~C2
const DEFAULT_FMAX_HZ = 1047; // ~C6
const DEFAULT_MIN_RMS = 0.01; // below this the signal is treated as silence, not a low note

export interface PitchDetectionResult {
  frequencyHz: number | null;
  /** 0..1 normalized autocorrelation strength at the detected lag - how "pitched" (tonal, periodic) the signal looks, not a statement about pitch accuracy. */
  confidence: number;
}

export interface AutocorrelateOptions {
  fminHz?: number;
  fmaxHz?: number;
  /** RMS amplitude below which the buffer is treated as silence/noise rather than attempting pitch detection. */
  minRms?: number;
}

/**
 * Estimates the fundamental frequency of one buffer of time-domain audio
 * samples via autocorrelation with parabolic interpolation for sub-sample
 * lag accuracy. Returns { frequencyHz: null, confidence: 0 } for silence or
 * signals with no clear periodicity in the target range (unvoiced
 * consonants, noise, silence) rather than guessing - the same "don't
 * fabricate a pitch" principle the worker's pyin-based detector follows.
 */
export function autocorrelate(buffer: Float32Array, sampleRate: number, options: AutocorrelateOptions = {}): PitchDetectionResult {
  const fminHz = options.fminHz ?? DEFAULT_FMIN_HZ;
  const fmaxHz = options.fmaxHz ?? DEFAULT_FMAX_HZ;
  const minRms = options.minRms ?? DEFAULT_MIN_RMS;

  const n = buffer.length;

  let sumSquares = 0;
  for (let i = 0; i < n; i++) sumSquares += buffer[i] * buffer[i];
  const rms = Math.sqrt(sumSquares / n);
  if (rms < minRms) {
    return { frequencyHz: null, confidence: 0 };
  }

  const minLag = Math.max(1, Math.floor(sampleRate / fmaxHz));
  const maxLag = Math.min(n - 1, Math.floor(sampleRate / fminHz));
  if (maxLag <= minLag) {
    return { frequencyHz: null, confidence: 0 };
  }

  // Prefix sum of squares so each lag's two energy terms (needed to
  // properly normalize its cross-correlation into a 0..1 confidence) are
  // O(1) lookups instead of an extra O(n) pass per lag - a lag has fewer
  // overlapping samples than lag 0 does, so normalizing every lag against
  // a single lag-0 energy (the usual cheap shortcut) systematically
  // under-scores longer lags (lower notes) rather than reflecting how
  // periodic the signal actually is at that lag.
  const prefixSumSquares = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefixSumSquares[i + 1] = prefixSumSquares[i] + buffer[i] * buffer[i];

  const correlations = new Float64Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let crossCorr = 0;
    for (let i = 0; i < n - lag; i++) crossCorr += buffer[i] * buffer[i + lag];
    const energyA = prefixSumSquares[n - lag];
    const energyB = prefixSumSquares[n] - prefixSumSquares[lag];
    const denom = Math.sqrt(energyA * energyB);
    correlations[lag] = denom > 0 ? crossCorr / denom : 0;
  }

  // A clean, steady tone correlates almost as strongly at 2x/3x its true
  // period as at the true period itself (integer multiples of a periodic
  // signal are also periodic), so simply taking the global maximum
  // correlation tends to lock onto a sub-harmonic and report half (or a
  // third, etc.) of the true frequency. Preferring the first local peak
  // that already clears a high-confidence threshold avoids that octave
  // error; only fall back to the true global max when nothing reaches it
  // (a quieter or less periodic signal, worth reporting at its own lower
  // confidence rather than not at all).
  const STRONG_PEAK_THRESHOLD = 0.85;
  let bestLag = -1;
  let bestCorr = 0;
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    const isLocalPeak = correlations[lag] >= correlations[lag - 1] && correlations[lag] >= correlations[lag + 1];
    if (isLocalPeak && correlations[lag] >= STRONG_PEAK_THRESHOLD) {
      bestLag = lag;
      bestCorr = correlations[lag];
      break;
    }
  }
  if (bestLag === -1) {
    for (let lag = minLag; lag <= maxLag; lag++) {
      if (correlations[lag] > bestCorr) {
        bestCorr = correlations[lag];
        bestLag = lag;
      }
    }
  }

  if (bestLag === -1) {
    return { frequencyHz: null, confidence: 0 };
  }

  const confidence = Math.min(1, Math.max(0, bestCorr));

  // Parabolic interpolation around the peak for sub-sample lag precision.
  let interpolatedLag = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const cLeft = correlations[bestLag - 1];
    const cCenter = bestCorr;
    const cRight = correlations[bestLag + 1];
    const denom = cLeft - 2 * cCenter + cRight;
    if (denom !== 0) {
      const shift = (0.5 * (cLeft - cRight)) / denom;
      if (Math.abs(shift) < 1) interpolatedLag = bestLag + shift;
    }
  }

  const frequencyHz = sampleRate / interpolatedLag;
  return { frequencyHz, confidence };
}
