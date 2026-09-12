"use client";

import type { SongSectionDTO, WaveformDTO } from "@singlearn/shared";
import { useRef } from "react";

const SECTION_COLORS: Record<string, string> = {
  chorus: "#5ee6c8",
  verse: "#8b8fed",
  bridge: "#f0b429",
  intro: "#4b5563",
  outro: "#4b5563",
  pre_chorus: "#c084fc",
  instrumental: "#4b5563",
  unknown: "#4b5563",
};

export function Waveform({
  waveform,
  sections,
  durationSec,
  currentTime,
  onSeek,
}: {
  waveform: WaveformDTO | null;
  sections: SongSectionDTO[];
  durationSec: number;
  currentTime: number;
  onSeek: (t: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  if (!waveform || waveform.peaks.length === 0) {
    return <div className="text-muted" style={{ fontSize: 13 }}>Waveform unavailable.</div>;
  }

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const fraction = (e.clientX - rect.left) / rect.width;
    onSeek(Math.max(0, Math.min(durationSec, fraction * durationSec)));
  }

  const playedFraction = durationSec > 0 ? currentTime / durationSec : 0;

  return (
    <div>
      <div
        ref={containerRef}
        onClick={handleClick}
        data-testid="waveform"
        style={{
          position: "relative",
          height: 56,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 1,
          background: "var(--surface-2)",
          borderRadius: 8,
          overflow: "hidden",
          border: "1px solid var(--border)",
        }}
      >
        {waveform.peaks.map((p, i) => {
          const fraction = i / waveform.peaks.length;
          const played = fraction <= playedFraction;
          return (
            <div
              key={i}
              style={{
                flex: 1,
                height: `${Math.max(4, p * 100)}%`,
                background: played ? "var(--accent)" : "var(--text-muted)",
                opacity: played ? 1 : 0.5,
              }}
            />
          );
        })}
        <div
          style={{
            position: "absolute",
            left: `${playedFraction * 100}%`,
            top: 0,
            bottom: 0,
            width: 2,
            background: "var(--warn)",
          }}
        />
      </div>
      {sections.length > 0 && (
        <div style={{ display: "flex", height: 6, marginTop: 4, borderRadius: 4, overflow: "hidden" }}>
          {sections.map((s) => (
            <div
              key={s.id}
              title={s.label}
              style={{
                width: `${((s.end - s.start) / durationSec) * 100}%`,
                background: SECTION_COLORS[s.type] ?? "#4b5563",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
