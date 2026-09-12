"use client";

import type { DifficultPartDTO } from "@singlearn/shared";

const REASON_LABELS: Record<string, string> = {
  large_interval_jump: "Large pitch jump",
  highest_note: "Highest note",
  lowest_note: "Lowest note",
  long_sustain: "Long sustained note",
  rapid_melodic_change: "Rapid melodic change",
};

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function DifficultPartsPanel({
  parts,
  onLoop,
}: {
  parts: DifficultPartDTO[];
  onLoop: (part: DifficultPartDTO) => void;
}) {
  if (parts.length === 0) {
    return <p className="text-muted" style={{ fontSize: 13 }}>No especially difficult passages identified (estimate).</p>;
  }

  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
      {parts.map((part) => (
        <li key={part.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div>
            <div style={{ fontSize: 13 }}>
              {formatTime(part.start)}–{formatTime(part.end)} — {REASON_LABELS[part.reason] ?? part.reason}
            </div>
            <div className="text-muted" style={{ fontSize: 12 }}>
              {part.detail}
            </div>
          </div>
          <button className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: 12, flexShrink: 0 }} onClick={() => onLoop(part)}>
            Loop
          </button>
        </li>
      ))}
    </ul>
  );
}
