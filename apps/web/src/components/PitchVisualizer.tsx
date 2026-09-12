"use client";

import { centsOffFromMidi, hzToMidi, midiToNoteName } from "@singlearn/shared";
import type { MelodyNoteDTO } from "@singlearn/shared";
import type { LivePitchSample } from "@/lib/useMicrophonePitch";
import { useEffect, useRef } from "react";

const PAST_WINDOW_SEC = 2.5;
const FUTURE_WINDOW_SEC = 5.5;
const PLAYHEAD_FRACTION = PAST_WINDOW_SEC / (PAST_WINDOW_SEC + FUTURE_WINDOW_SEC);
const LIVE_PITCH_MIN_CONFIDENCE = 0.5;

// Canvas 2D can't read CSS custom properties directly, so these mirror
// globals.css's palette (grey/black/red only). The target melody (fixed,
// reference) and the live mic path (real-time, "you") need to stay visually
// distinguishable at a glance without relying on hue the way the old
// teal-vs-red scheme did, so the target is rendered in white/grey and only
// the live user path uses the red accent - the one place in this chart
// where red specifically means "this is you, look here."
const CANVAS_BG = "#0a0a0b";
const CANVAS_MUTED_TEXT = "#9a9a9d";
const CANVAS_GUIDE_LINE_OCTAVE = "#303032";
const CANVAS_GUIDE_LINE_SEMITONE = "#1f1f21";
const CANVAS_TARGET_NOTE = "237, 237, 238"; // rgb triplet for rgba() with variable opacity below
const CANVAS_LIVE_USER_PITCH = "#ef4444";
const CANVAS_PLAYHEAD = "#e5e5e6";

export function PitchVisualizer({
  notes,
  currentTime,
  liveUserSamples,
}: {
  notes: MelodyNoteDTO[];
  currentTime: number;
  /** Recent microphone pitch samples (see useMicrophonePitch) to overlay as the user's real-time path against the target melody. Omit entirely when mic practice isn't enabled. */
  liveUserSamples?: LivePitchSample[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    const height = 180;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = CANVAS_BG;
    ctx.fillRect(0, 0, width, height);

    const windowStart = currentTime - PAST_WINDOW_SEC;
    const windowEnd = currentTime + FUTURE_WINDOW_SEC;
    const visible = notes.filter((n) => n.end >= windowStart && n.start <= windowEnd);

    if (notes.length === 0) {
      ctx.fillStyle = CANVAS_MUTED_TEXT;
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("No confident melody detected for this section", width / 2, height / 2);
      return;
    }

    const visibleUserSamples = (liveUserSamples ?? []).filter(
      (s) => s.frequencyHz !== null && s.confidence >= LIVE_PITCH_MIN_CONFIDENCE && s.t >= windowStart && s.t <= windowEnd
    );

    const midis = notes.map((n) => n.midi).concat(visibleUserSamples.map((s) => hzToMidi(s.frequencyHz as number)));
    const minMidi = Math.min(...midis) - 2;
    const maxMidi = Math.max(...midis) + 2;
    const midiRange = Math.max(1, maxMidi - minMidi);

    const timeToX = (t: number) => (t - currentTime) * ((width * (1 - PLAYHEAD_FRACTION)) / FUTURE_WINDOW_SEC) + width * PLAYHEAD_FRACTION;
    const midiToY = (midi: number) => height - ((midi - minMidi) / midiRange) * height;

    // Horizontal guide lines per semitone (lighter on non-natural notes).
    for (let m = Math.ceil(minMidi); m <= Math.floor(maxMidi); m++) {
      const y = midiToY(m);
      ctx.strokeStyle = m % 12 === 0 ? CANVAS_GUIDE_LINE_OCTAVE : CANVAS_GUIDE_LINE_SEMITONE;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    for (const note of visible) {
      const x1 = Math.max(0, timeToX(note.start));
      const x2 = Math.min(width, timeToX(note.end));
      const y = midiToY(note.midi);
      const isPast = note.end < currentTime;
      ctx.fillStyle = isPast
        ? `rgba(${CANVAS_TARGET_NOTE}, 0.35)`
        : `rgba(${CANVAS_TARGET_NOTE}, ${0.5 + note.confidence * 0.5})`;
      const barHeight = 10;
      const radius = 4;
      const w = Math.max(2, x2 - x1);
      roundRect(ctx, x1, y - barHeight / 2, w, barHeight, radius);
      ctx.fill();
    }

    // Live microphone pitch: the user's real-time path, overlaid on the
    // fixed target curve above so the two are directly comparable at a
    // glance (small gaps in the line where the user was silent/unvoiced or
    // the detector wasn't confident are left as gaps, not interpolated
    // through, so silence never reads as "on pitch").
    if (visibleUserSamples.length > 0) {
      ctx.strokeStyle = CANVAS_LIVE_USER_PITCH;
      ctx.lineWidth = 2;
      ctx.beginPath();
      let drawing = false;
      for (const sample of visibleUserSamples) {
        const x = timeToX(sample.t);
        const y = midiToY(hzToMidi(sample.frequencyHz as number));
        if (!drawing) {
          ctx.moveTo(x, y);
          drawing = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }

    // Playhead.
    const playheadX = width * PLAYHEAD_FRACTION;
    ctx.strokeStyle = CANVAS_PLAYHEAD;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, height);
    ctx.stroke();
  }, [notes, currentTime, liveUserSamples]);

  const targetNote = notes.find((n) => currentTime >= n.start && currentTime < n.end);
  const latestUserSample = liveUserSamples && liveUserSamples.length > 0 ? liveUserSamples[liveUserSamples.length - 1] : null;
  const liveCentsOff =
    targetNote && latestUserSample?.frequencyHz && latestUserSample.confidence >= LIVE_PITCH_MIN_CONFIDENCE
      ? Math.round(centsOffFromMidi(latestUserSample.frequencyHz, targetNote.midi))
      : null;

  return (
    <div ref={containerRef} style={{ width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
        <span className="text-muted" style={{ fontSize: 13 }}>
          Pitch guide{liveUserSamples ? " — target (grey) vs. your voice (red)" : ""}
        </span>
        <span style={{ fontSize: 15 }}>
          Target: <strong>{targetNote ? midiToNoteName(targetNote.midi) : "—"}</strong>
          {liveCentsOff !== null && (
            <span className="text-muted" style={{ marginLeft: 10 }}>
              You: {liveCentsOff > 0 ? "+" : ""}
              {liveCentsOff} cents
            </span>
          )}
        </span>
      </div>
      <canvas ref={canvasRef} style={{ display: "block", borderRadius: 8, border: "1px solid var(--border)" }} />
    </div>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
