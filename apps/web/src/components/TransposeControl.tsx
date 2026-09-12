"use client";

import { MAX_TRANSPOSE_SEMITONES, MIN_TRANSPOSE_SEMITONES } from "@singlearn/shared";

const OPTIONS = Array.from(
  { length: MAX_TRANSPOSE_SEMITONES - MIN_TRANSPOSE_SEMITONES + 1 },
  (_, i) => MIN_TRANSPOSE_SEMITONES + i
);

/**
 * Practice/pitch-guide transpose: shifts the target melody and live mic
 * comparison by -3..+3 semitones so a singer can find a comfortable key.
 * This does not (and, without re-processing the audio, cannot) change the
 * pitch of the backing track itself - it's a guide/reference shift, the
 * same way a singer might practice against a recording in a different key
 * than they'll perform in.
 */
export function TransposeControl({ value, onChange }: { value: number; onChange: (semitones: number) => void }) {
  return (
    <div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {OPTIONS.map((semitones) => (
          <button
            key={semitones}
            className={value === semitones ? "btn" : "btn btn-secondary"}
            onClick={() => onChange(semitones)}
            style={{ padding: "4px 10px", fontSize: 12, minWidth: 34 }}
            title={semitones === 0 ? "Original pitch" : `Shift ${Math.abs(semitones)} semitone${Math.abs(semitones) === 1 ? "" : "s"} ${semitones > 0 ? "up" : "down"}`}
          >
            {semitones > 0 ? `+${semitones}` : semitones}
          </button>
        ))}
      </div>
      {value !== 0 && (
        <p className="text-muted" style={{ fontSize: 12, marginTop: 6, marginBottom: 0 }}>
          Pitch guide and mic feedback are shifted {Math.abs(value)} semitone{Math.abs(value) === 1 ? "" : "s"}{" "}
          {value > 0 ? "up" : "down"}. The backing track itself still plays in the original key.
        </p>
      )}
    </div>
  );
}
