"use client";

import { autocorrelate } from "@singlearn/shared";
import { useCallback, useEffect, useRef, useState } from "react";

export type MicPermissionState = "idle" | "requesting" | "granted" | "denied" | "unsupported";

export interface LivePitchSample {
  /** Canonical playback time (seconds) this sample was captured at. */
  t: number;
  frequencyHz: number | null;
  confidence: number;
}

const FFT_SIZE = 2048;
// ~20Hz is plenty for a practice aid (pitch doesn't need 60fps resolution)
// and keeps the autocorrelation cheap enough for a browser main thread.
const DETECTION_INTERVAL_MS = 50;
// How much sample history to retain for feedback/visualization before old
// samples are dropped, bounding memory for a long-running session.
const HISTORY_SEC = 15;

/**
 * Live microphone pitch tracking for the "compare your voice to the
 * target melody" practice feature. Never requests the microphone until
 * `start()` is called (explicit opt-in) and never records or uploads
 * audio anywhere - only per-frame {time, frequency, confidence} numbers
 * are kept, in memory, for as long as this hook is mounted.
 */
export function useMicrophonePitch(getCurrentTime: () => number) {
  const [permission, setPermission] = useState<MicPermissionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [latest, setLatest] = useState<LivePitchSample | null>(null);
  const samplesRef = useRef<LivePitchSample[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
    samplesRef.current = [];
    setLatest(null);
    setPermission((current) => (current === "denied" || current === "unsupported" ? current : "idle"));
  }, []);

  const start = useCallback(async () => {
    setError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setPermission("unsupported");
      return;
    }
    setPermission("requesting");
    try {
      // Plain `audio: true` rather than requesting echoCancellation/
      // noiseSuppression/autoGainControl off: those would help pitch
      // tracking slightly, but some devices/browsers (including Chromium's
      // fake test device) reject the constrained request outright with
      // NotSupportedError instead of just ignoring an unsatisfiable ideal
      // constraint, which would silently break microphone practice rather
      // than degrade it.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      source.connect(analyser);

      const buffer = new Float32Array(FFT_SIZE);
      intervalRef.current = setInterval(() => {
        analyser.getFloatTimeDomainData(buffer);
        const result = autocorrelate(buffer, audioContext.sampleRate);
        const sample: LivePitchSample = { t: getCurrentTime(), frequencyHz: result.frequencyHz, confidence: result.confidence };
        const samples = samplesRef.current;
        samples.push(sample);
        const cutoff = sample.t - HISTORY_SEC;
        while (samples.length > 0 && samples[0].t < cutoff) samples.shift();
        setLatest(sample);
      }, DETECTION_INTERVAL_MS);

      setPermission("granted");
    } catch (err) {
      setPermission("denied");
      setError(err instanceof Error ? err.message : "Microphone access was denied.");
    }
  }, [getCurrentTime]);

  // Stop the microphone (and release the hardware indicator) if the
  // component unmounts while still enabled - never leave it running
  // silently in the background.
  useEffect(() => stop, [stop]);

  const clearHistory = useCallback(() => {
    samplesRef.current = [];
  }, []);

  return { permission, error, latest, samplesRef, start, stop, clearHistory };
}
