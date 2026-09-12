"use client";

import { midiToNoteName } from "@singlearn/shared";
import type { MelodyNoteDTO } from "@singlearn/shared";
import { useEffect, useRef } from "react";

const PAST_WINDOW_SEC = 2.5;
const FUTURE_WINDOW_SEC = 5.5;
const PLAYHEAD_FRACTION = PAST_WINDOW_SEC / (PAST_WINDOW_SEC + FUTURE_WINDOW_SEC);

export function PitchVisualizer({ notes, currentTime }: { notes: MelodyNoteDTO[]; currentTime: number }) {
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

    ctx.fillStyle = "#0f1216";
    ctx.fillRect(0, 0, width, height);

    const windowStart = currentTime - PAST_WINDOW_SEC;
    const windowEnd = currentTime + FUTURE_WINDOW_SEC;
    const visible = notes.filter((n) => n.end >= windowStart && n.start <= windowEnd);

    if (notes.length === 0) {
      ctx.fillStyle = "#6b7280";
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("No confident melody detected for this section", width / 2, height / 2);
      return;
    }

    const midis = notes.map((n) => n.midi);
    const minMidi = Math.min(...midis) - 2;
    const maxMidi = Math.max(...midis) + 2;
    const midiRange = Math.max(1, maxMidi - minMidi);

    const timeToX = (t: number) => (t - currentTime) * ((width * (1 - PLAYHEAD_FRACTION)) / FUTURE_WINDOW_SEC) + width * PLAYHEAD_FRACTION;
    const midiToY = (midi: number) => height - ((midi - minMidi) / midiRange) * height;

    // Horizontal guide lines per semitone (lighter on non-natural notes).
    for (let m = Math.ceil(minMidi); m <= Math.floor(maxMidi); m++) {
      const y = midiToY(m);
      ctx.strokeStyle = m % 12 === 0 ? "#2a2f38" : "#1c2027";
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
      ctx.fillStyle = isPast ? "rgba(94, 230, 200, 0.35)" : `rgba(94, 230, 200, ${0.5 + note.confidence * 0.5})`;
      const barHeight = 10;
      const radius = 4;
      const w = Math.max(2, x2 - x1);
      roundRect(ctx, x1, y - barHeight / 2, w, barHeight, radius);
      ctx.fill();
    }

    // Playhead.
    const playheadX = width * PLAYHEAD_FRACTION;
    ctx.strokeStyle = "#f0b429";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, height);
    ctx.stroke();
  }, [notes, currentTime]);

  const targetNote = notes.find((n) => currentTime >= n.start && currentTime < n.end);

  return (
    <div ref={containerRef} style={{ width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <span className="text-muted" style={{ fontSize: 13 }}>
          Pitch guide
        </span>
        <span style={{ fontSize: 15 }}>
          Target: <strong>{targetNote ? midiToNoteName(targetNote.midi) : "—"}</strong>
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
