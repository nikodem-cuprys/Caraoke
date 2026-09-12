"use client";

import { evaluateExerciseAttempt } from "@singlearn/shared";
import type { DifficultPartDTO, MelodyNoteDTO, PlaybackSpeed } from "@singlearn/shared";
import type { MutableRefObject } from "react";
import { useEffect, useRef, useState } from "react";
import type { LivePitchSample, MicPermissionState } from "@/lib/useMicrophonePitch";
import { getExerciseCleanPassCount, MASTERY_THRESHOLD, recordExerciseAttempt } from "@/lib/exerciseProgress";

const REASON_LABELS: Record<string, string> = {
  large_interval_jump: "Large pitch jump",
  highest_note: "Highest note",
  lowest_note: "Lowest note",
  long_sustain: "Long sustained note",
  rapid_melodic_change: "Rapid melodic change",
};

// Slowed down automatically when an exercise starts (see command.txt FUTURE
// FEATURES: "vocal exercises based on difficult notes") - a gentler default
// than full speed for a passage the pipeline already flagged as tricky.
const EXERCISE_PLAYBACK_RATE: PlaybackSpeed = 0.75;

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Lists the pipeline's flagged difficult passages and, per passage, offers
 * a focused practice exercise: loop it, slow it to 0.75x automatically, and
 * check each sung attempt against the target notes (evaluateExerciseAttempt)
 * to build up a cumulative "clean pass" count toward a mastery badge -
 * turning the existing loop-a-passage feature into an actual practice loop
 * instead of just a listening aid.
 */
export function DifficultPartsPanel({
  songId,
  parts,
  melodyNotes,
  micPermission,
  micError,
  micSamplesRef,
  micStart,
  micClearHistory,
  playbackRate,
  onSetPlaybackRate,
  onLoop,
  onClearLoop,
}: {
  songId: string;
  parts: DifficultPartDTO[];
  /** Transposed target notes - an attempt is judged against whatever key the user is currently practicing in. */
  melodyNotes: MelodyNoteDTO[];
  micPermission: MicPermissionState;
  micError: string | null;
  micSamplesRef: MutableRefObject<LivePitchSample[]>;
  micStart: () => void;
  micClearHistory: () => void;
  playbackRate: PlaybackSpeed;
  onSetPlaybackRate: (speed: PlaybackSpeed) => void;
  onLoop: (part: DifficultPartDTO) => void;
  onClearLoop: () => void;
}) {
  const [activePartId, setActivePartId] = useState<string | null>(null);
  const [progressByPart, setProgressByPart] = useState<Record<string, number>>({});
  const [lastResult, setLastResult] = useState<ReturnType<typeof evaluateExerciseAttempt> | null>(null);
  const previousRateRef = useRef<PlaybackSpeed | null>(null);

  useEffect(() => {
    const map: Record<string, number> = {};
    for (const part of parts) map[part.id] = getExerciseCleanPassCount(songId, part.id);
    setProgressByPart(map);
  }, [songId, parts]);

  if (parts.length === 0) {
    return <p className="text-muted" style={{ fontSize: 13 }}>No especially difficult passages identified (estimate).</p>;
  }

  function startExercise(part: DifficultPartDTO) {
    if (micPermission === "idle" || micPermission === "denied") micStart();
    micClearHistory();
    previousRateRef.current = playbackRate;
    onSetPlaybackRate(EXERCISE_PLAYBACK_RATE);
    onLoop(part);
    setActivePartId(part.id);
    setLastResult(null);
  }

  function stopExercise() {
    if (previousRateRef.current !== null) onSetPlaybackRate(previousRateRef.current);
    previousRateRef.current = null;
    onClearLoop();
    setActivePartId(null);
    setLastResult(null);
  }

  function checkAttempt(part: DifficultPartDTO) {
    const result = evaluateExerciseAttempt(micSamplesRef.current, melodyNotes);
    micClearHistory();
    setLastResult(result);
    if (result.hasEnoughSignal) {
      const updated = recordExerciseAttempt(songId, part.id, result.isClean);
      setProgressByPart((prev) => ({ ...prev, [part.id]: updated }));
    }
  }

  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
      {parts.map((part) => {
        const isActive = activePartId === part.id;
        const cleanPassCount = progressByPart[part.id] ?? 0;
        const isMastered = cleanPassCount >= MASTERY_THRESHOLD;

        return (
          <li key={part.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div>
                <div style={{ fontSize: 13 }}>
                  {formatTime(part.start)}–{formatTime(part.end)} — {REASON_LABELS[part.reason] ?? part.reason}
                  {isMastered && (
                    <span className="badge" style={{ marginLeft: 8 }}>
                      Mastered ✓
                    </span>
                  )}
                </div>
                <div className="text-muted" style={{ fontSize: 12 }}>
                  {part.detail}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <button className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => onLoop(part)}>
                  Loop
                </button>
                {isActive ? (
                  <button className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: 12 }} onClick={stopExercise}>
                    Done practicing
                  </button>
                ) : (
                  <button className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => startExercise(part)}>
                    Practice this
                  </button>
                )}
              </div>
            </div>

            {isActive && (
              <div style={{ marginTop: 8, paddingLeft: 4, borderLeft: "2px solid var(--border)" }}>
                <p className="text-muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 6 }}>
                  Looping at {EXERCISE_PLAYBACK_RATE}× — sing through it, then check your attempt.
                  {micPermission === "denied" && (
                    <span style={{ color: "var(--danger)" }}> {micError ?? "Microphone access was denied."}</span>
                  )}
                </p>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <button
                    className="btn"
                    style={{ padding: "4px 10px", fontSize: 12 }}
                    onClick={() => checkAttempt(part)}
                    disabled={micPermission !== "granted"}
                  >
                    Check this attempt
                  </button>
                  <span className="text-muted" style={{ fontSize: 12 }}>
                    {cleanPassCount}/{MASTERY_THRESHOLD} clean passes
                  </span>
                </div>
                {lastResult && (
                  <p style={{ fontSize: 12, marginTop: 6, marginBottom: 0 }}>
                    {!lastResult.hasEnoughSignal
                      ? "Not enough signal yet - sing through the loop and try again."
                      : lastResult.isClean
                        ? "Clean pass! ✓"
                        : `Getting there${
                            lastResult.coveragePct !== null ? ` — ${Math.round(lastResult.coveragePct)}% covered` : ""
                          }${
                            lastResult.meanAbsCentsOff !== null
                              ? `, ~${Math.round(lastResult.meanAbsCentsOff)} cents off on average`
                              : ""
                          }.`}
                  </p>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
