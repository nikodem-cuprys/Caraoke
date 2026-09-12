"use client";

import { estimateHeldNoteMidi, evaluateVocalRangeFit, midiToNoteName } from "@singlearn/shared";
import type { MidiRange, VocalRangeDTO } from "@singlearn/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMicrophonePitch } from "@/lib/useMicrophonePitch";
import { clearStoredVocalRange, getStoredVocalRange, setStoredVocalRange } from "@/lib/vocalRangeStorage";

// How long the user holds each note during calibration. Long enough to
// gather well over estimateHeldNoteMidi's minSamples at the ~20Hz detection
// rate, short enough that a two-note calibration doesn't feel tedious.
const CAPTURE_MS = 2200;

type Phase = "idle" | "starting" | "calibrate-low" | "calibrate-high" | "done";

/**
 * Makes the song's detected vocal range actionable instead of just
 * informational: renders it on a visual scale, lets the user calibrate
 * their own range with a two-note microphone capture (reusing
 * useMicrophonePitch - no audio is ever recorded, same privacy guarantee as
 * mic practice), and - the part command.txt actually asks for ("this helps
 * the user understand whether the song fits their range") - tells them
 * whether it fits and offers a one-click transpose if it doesn't.
 */
export function VocalRangeCard({
  songRange,
  transposeSemitones,
  onApplyTranspose,
}: {
  songRange: VocalRangeDTO;
  transposeSemitones: number;
  onApplyTranspose: (semitones: number) => void;
}) {
  const getCalibrationClock = useCallback(() => performance.now() / 1000, []);
  const mic = useMicrophonePitch(getCalibrationClock);

  const [userRange, setUserRange] = useState<MidiRange | null>(null);
  // Loaded client-side only, after mount, to avoid an SSR/hydration mismatch
  // (the server has no localStorage to read from).
  useEffect(() => {
    setUserRange(getStoredVocalRange());
  }, []);

  const [phase, setPhase] = useState<Phase>("idle");
  const [attempt, setAttempt] = useState(0);
  const [stepError, setStepError] = useState<"low" | "high" | null>(null);
  const lowMidiRef = useRef<number | null>(null);

  const handleStart = useCallback(() => {
    setPhase("starting");
    mic.start();
  }, [mic.start]);

  const handleCancel = useCallback(() => {
    mic.stop();
    setPhase("idle");
  }, [mic.stop]);

  const handleClear = useCallback(() => {
    setUserRange(null);
    clearStoredVocalRange();
  }, []);

  // Once the mic hook actually has permission, begin the first ("lowest
  // note") capture step.
  useEffect(() => {
    if (phase === "starting" && mic.permission === "granted") {
      lowMidiRef.current = null;
      setAttempt((a) => a + 1);
      setPhase("calibrate-low");
    }
    if (phase === "starting" && mic.permission === "denied") {
      setPhase("idle");
    }
  }, [phase, mic.permission]);

  // Runs (and re-runs on a manual retry via `attempt`) each timed capture
  // step: listen for CAPTURE_MS, then read back the held note.
  useEffect(() => {
    if (phase !== "calibrate-low" && phase !== "calibrate-high") return;
    setStepError(null);
    mic.clearHistory();
    const timer = setTimeout(() => {
      const midi = estimateHeldNoteMidi(mic.samplesRef.current);
      if (midi === null) {
        setStepError(phase === "calibrate-low" ? "low" : "high");
        return;
      }
      if (phase === "calibrate-low") {
        lowMidiRef.current = midi;
        setPhase("calibrate-high");
        return;
      }
      const low = lowMidiRef.current;
      if (low === null || midi <= low) {
        // The "highest" note wasn't actually higher - most likely the user
        // held roughly the same pitch twice. Ask them to redo this step
        // rather than saving a zero/negative-width range.
        setStepError("high");
        return;
      }
      const range: MidiRange = { lowestMidi: low, highestMidi: midi };
      setUserRange(range);
      setStoredVocalRange(range);
      mic.stop();
      setPhase("done");
    }, CAPTURE_MS);
    return () => clearTimeout(timer);
  }, [phase, attempt, mic.clearHistory, mic.stop]);

  const fitResult = useMemo(() => {
    if (!userRange) return null;
    return evaluateVocalRangeFit({ lowestMidi: songRange.lowestMidi, highestMidi: songRange.highestMidi }, userRange);
  }, [userRange, songRange]);

  return (
    <div style={{ marginTop: 8 }}>
      <VocalRangeBar songRange={songRange} transposeSemitones={transposeSemitones} userRange={userRange} />

      {(phase === "idle" || phase === "done") && (
        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn btn-secondary" style={{ fontSize: 12, padding: "6px 12px" }} onClick={handleStart}>
            {userRange ? "Recalibrate my range" : "Test your range"}
          </button>
          {userRange && (
            <button className="btn btn-secondary" style={{ fontSize: 12, padding: "6px 12px" }} onClick={handleClear}>
              Clear
            </button>
          )}
        </div>
      )}

      {phase === "starting" && (
        <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
          {mic.error ?? "Requesting microphone access…"}
        </p>
      )}

      {(phase === "calibrate-low" || phase === "calibrate-high") &&
        (stepError ? (
          <div style={{ marginTop: 10 }}>
            <p style={{ fontSize: 12, color: "var(--danger)" }}>
              {stepError === "high" && lowMidiRef.current !== null
                ? "That didn't sound higher than your lowest note - try again, aiming a bit higher."
                : "Couldn't detect a clear, steady pitch - try again, humming a bit louder."}
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" style={{ fontSize: 12, padding: "6px 12px" }} onClick={() => setAttempt((a) => a + 1)}>
                Try again
              </button>
              <button className="btn btn-secondary" style={{ fontSize: 12, padding: "6px 12px" }} onClick={handleCancel}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <CaptureProgress
            key={`${phase}-${attempt}`}
            durationMs={CAPTURE_MS}
            label={
              phase === "calibrate-low"
                ? "Hum and hold your lowest comfortable note…"
                : "Now hum and hold your highest comfortable note…"
            }
          />
        ))}

      {fitResult && (
        <p style={{ fontSize: 13, marginTop: 10 }}>
          {fitResult.fit === "fits" && "This song's range already fits your voice."}
          {fitResult.fit === "fits_with_transpose" &&
            (transposeSemitones === fitResult.suggestedTransposeSemitones ? (
              <span className="text-muted">
                Shifted {fitResult.suggestedTransposeSemitones > 0 ? "+" : ""}
                {fitResult.suggestedTransposeSemitones} semitones to fit your range. Applied ✓
              </span>
            ) : (
              <>
                Shift by{" "}
                <strong>
                  {fitResult.suggestedTransposeSemitones > 0 ? "+" : ""}
                  {fitResult.suggestedTransposeSemitones}
                </strong>{" "}
                semitones to fit your range.{" "}
                <button
                  className="btn"
                  style={{ fontSize: 12, padding: "4px 10px" }}
                  onClick={() => onApplyTranspose(fitResult.suggestedTransposeSemitones)}
                >
                  Apply suggested transpose
                </button>
              </>
            ))}
          {fitResult.fit === "still_out_of_range" && (
            <span className="text-muted">
              Even at the maximum transpose, this song&apos;s range is wider than yours - some sections may still be a
              stretch.
            </span>
          )}
        </p>
      )}
    </div>
  );
}

function VocalRangeBar({
  songRange,
  transposeSemitones,
  userRange,
}: {
  songRange: VocalRangeDTO;
  transposeSemitones: number;
  userRange: MidiRange | null;
}) {
  const transposedLow = songRange.lowestMidi + transposeSemitones;
  const transposedHigh = songRange.highestMidi + transposeSemitones;
  const candidates = [
    songRange.lowestMidi,
    songRange.highestMidi,
    transposedLow,
    transposedHigh,
    ...(userRange ? [userRange.lowestMidi, userRange.highestMidi] : []),
  ];
  const scaleMin = Math.min(...candidates) - 2;
  const scaleMax = Math.max(...candidates) + 2;
  const scaleSpan = Math.max(1, scaleMax - scaleMin);
  const toPercent = (midi: number) => ((midi - scaleMin) / scaleSpan) * 100;

  return (
    <div>
      <RangeTrack
        label="Song"
        lowestMidi={songRange.lowestMidi}
        highestMidi={songRange.highestMidi}
        lowestLabel={songRange.lowestNote}
        highestLabel={songRange.highestNote}
        toPercent={toPercent}
        fillColor="rgba(237, 237, 238, 0.4)"
        overlay={transposeSemitones !== 0 ? { lowestMidi: transposedLow, highestMidi: transposedHigh } : undefined}
      />
      {userRange && (
        <RangeTrack
          label="You"
          lowestMidi={userRange.lowestMidi}
          highestMidi={userRange.highestMidi}
          lowestLabel={midiToNoteName(userRange.lowestMidi)}
          highestLabel={midiToNoteName(userRange.highestMidi)}
          toPercent={toPercent}
          fillColor="var(--accent)"
        />
      )}
    </div>
  );
}

function RangeTrack({
  label,
  lowestMidi,
  highestMidi,
  lowestLabel,
  highestLabel,
  toPercent,
  fillColor,
  overlay,
}: {
  label: string;
  lowestMidi: number;
  highestMidi: number;
  lowestLabel: string;
  highestLabel: string;
  toPercent: (midi: number) => number;
  fillColor: string;
  overlay?: { lowestMidi: number; highestMidi: number };
}) {
  const left = toPercent(lowestMidi);
  const width = Math.max(1.5, toPercent(highestMidi) - left);
  return (
    <div style={{ marginTop: 6 }}>
      <div className="text-muted" style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
        <span>{label}</span>
        <span>
          {lowestLabel}–{highestLabel}
        </span>
      </div>
      <div
        style={{
          position: "relative",
          height: 10,
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
          borderRadius: 5,
          marginTop: 2,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${left}%`,
            width: `${width}%`,
            background: fillColor,
            borderRadius: 4,
          }}
        />
        {overlay && (
          <div
            title="Where the song's range lands after the current practice-guide transpose"
            style={{
              position: "absolute",
              top: -2,
              bottom: -2,
              left: `${toPercent(overlay.lowestMidi)}%`,
              width: `${Math.max(1.5, toPercent(overlay.highestMidi) - toPercent(overlay.lowestMidi))}%`,
              border: "1px solid var(--accent)",
              borderRadius: 6,
            }}
          />
        )}
      </div>
    </div>
  );
}

// A CSS-driven shrinking bar rather than a setInterval countdown - one
// transition covers the whole capture window with no extra render churn.
function CaptureProgress({ durationMs, label }: { durationMs: number; label: string }) {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    el.style.transition = "none";
    el.style.width = "100%";
    const raf = requestAnimationFrame(() => {
      el.style.transition = `width ${durationMs}ms linear`;
      el.style.width = "0%";
    });
    return () => cancelAnimationFrame(raf);
  }, [durationMs]);

  return (
    <div>
      <p className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>
        🎤 {label}
      </p>
      <div style={{ height: 6, background: "var(--surface-2)", borderRadius: 3, overflow: "hidden" }}>
        <div ref={barRef} style={{ height: "100%", background: "var(--accent)" }} />
      </div>
    </div>
  );
}
