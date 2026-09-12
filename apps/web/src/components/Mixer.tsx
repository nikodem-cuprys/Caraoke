"use client";

import type { MixerPreset } from "@/lib/usePlayer";

const PRESETS: { key: Exclude<MixerPreset, "custom">; label: string; description: string }[] = [
  { key: "original", label: "Original", description: "Full vocals + instrumental" },
  { key: "learn", label: "Learn", description: "Vocals loud, instrumental quieter" },
  { key: "practice", label: "Practice", description: "Vocals quiet, instrumental loud" },
  { key: "karaoke", label: "Karaoke", description: "Vocals muted" },
];

export function Mixer({
  stemsAvailable,
  separationEngine,
  preset,
  vocalsVolume,
  instrumentalVolume,
  onApplyPreset,
  onCustomVolumes,
}: {
  stemsAvailable: boolean;
  separationEngine: string | null;
  preset: MixerPreset;
  vocalsVolume: number;
  instrumentalVolume: number;
  onApplyPreset: (preset: Exclude<MixerPreset, "custom">) => void;
  onCustomVolumes: (vocals: number, instrumental: number) => void;
}) {
  if (!stemsAvailable) {
    return (
      <div className="text-muted" style={{ fontSize: 13 }}>
        Isolated vocals/instrumental aren&apos;t available for this song (separation did not run or was unavailable
        in this deployment) — you&apos;ll practice against the original mix.
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {PRESETS.map((p) => (
          <button
            key={p.key}
            className={preset === p.key ? "btn" : "btn btn-secondary"}
            title={p.description}
            onClick={() => onApplyPreset(p.key)}
            style={{ padding: "8px 14px", fontSize: 13 }}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 40px", gap: 8, alignItems: "center", fontSize: 13 }}>
        <span>Vocals</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={vocalsVolume}
          onChange={(e) => onCustomVolumes(parseFloat(e.target.value), instrumentalVolume)}
        />
        <span className="text-muted">{Math.round(vocalsVolume * 100)}%</span>

        <span>Instrumental</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={instrumentalVolume}
          onChange={(e) => onCustomVolumes(vocalsVolume, parseFloat(e.target.value))}
        />
        <span className="text-muted">{Math.round(instrumentalVolume * 100)}%</span>
      </div>
      {separationEngine && (
        <div className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
          Separated with {separationEngine}
        </div>
      )}
    </div>
  );
}
