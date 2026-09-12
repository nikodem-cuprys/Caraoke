"use client";

import { buildSingingFeedback, hzToMidi, midiToNoteName, type SingingInsight } from "@singlearn/shared";
import type { LyricLineDTO, MelodyNoteDTO } from "@singlearn/shared";
import type { MutableRefObject } from "react";
import { useState } from "react";
import type { LivePitchSample, MicPermissionState } from "@/lib/useMicrophonePitch";

const LIVE_PITCH_MIN_CONFIDENCE = 0.5;

export function MicPracticePanel({
  permission,
  error,
  latest,
  start,
  stop,
  clearHistory,
  samplesRef,
  melodyNotes,
  lines,
}: {
  permission: MicPermissionState;
  error: string | null;
  /** Most recent detection result, shown as a "listening" status independent of whether a target note is active right now (e.g. during an instrumental section). */
  latest: LivePitchSample | null;
  start: () => void;
  stop: () => void;
  clearHistory: () => void;
  samplesRef: MutableRefObject<LivePitchSample[]>;
  melodyNotes: MelodyNoteDTO[];
  lines: LyricLineDTO[];
}) {
  const [insights, setInsights] = useState<SingingInsight[] | null>(null);

  function handleGetFeedback() {
    const feedback = buildSingingFeedback(samplesRef.current, melodyNotes, lines);
    setInsights(feedback);
    clearHistory();
  }

  if (permission === "idle" || permission === "unsupported") {
    return (
      <div>
        <p style={{ marginTop: 0, fontSize: 13 }} className="text-muted">
          Sing along and see how your pitch compares to the target melody in real time. Your voice is analyzed
          locally in your browser — it is never recorded, saved, or sent anywhere.
        </p>
        {permission === "unsupported" ? (
          <p style={{ fontSize: 13, color: "var(--danger)" }}>Microphone access isn&apos;t available in this browser.</p>
        ) : (
          <button className="btn" onClick={start} style={{ fontSize: 13, padding: "8px 14px" }}>
            Enable microphone practice
          </button>
        )}
      </div>
    );
  }

  if (permission === "requesting") {
    return <p className="text-muted" style={{ fontSize: 13 }}>Requesting microphone access…</p>;
  }

  if (permission === "denied") {
    return (
      <div>
        <p style={{ fontSize: 13, color: "var(--danger)" }}>{error ?? "Microphone access was denied."}</p>
        <button className="btn btn-secondary" onClick={start} style={{ fontSize: 13, padding: "8px 14px" }}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <span className="badge">🎤 Microphone practice active</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary" onClick={handleGetFeedback} style={{ fontSize: 12, padding: "6px 12px" }}>
            Get feedback on this take
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => {
              stop();
              setInsights(null);
            }}
            style={{ fontSize: 12, padding: "6px 12px" }}
          >
            Disable
          </button>
        </div>
      </div>

      <p data-testid="mic-live-status" className="text-muted" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
        {latest?.frequencyHz && latest.confidence >= LIVE_PITCH_MIN_CONFIDENCE
          ? `Listening — detected ${midiToNoteName(hzToMidi(latest.frequencyHz))}`
          : "Listening — no clear pitch detected"}
      </p>

      {insights && (
        <ul style={{ marginTop: 12, paddingLeft: 20, fontSize: 13, lineHeight: 1.6 }}>
          {insights.map((insight, i) => (
            <li key={i}>{insight.text}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
