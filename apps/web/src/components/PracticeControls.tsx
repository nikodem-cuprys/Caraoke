"use client";

import type { PlaybackSpeed } from "@singlearn/shared";

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function PracticeControls({
  isPlaying,
  currentTime,
  durationSec,
  playbackRate,
  playbackSpeeds,
  onPlay,
  onPause,
  onPrevLine,
  onNextLine,
  onRewind5,
  onReplayLine,
  onSetSpeed,
}: {
  isPlaying: boolean;
  currentTime: number;
  durationSec: number;
  playbackRate: PlaybackSpeed;
  playbackSpeeds: readonly PlaybackSpeed[];
  onPlay: () => void;
  onPause: () => void;
  onPrevLine: () => void;
  onNextLine: () => void;
  onRewind5: () => void;
  onReplayLine: () => void;
  onSetSpeed: (speed: PlaybackSpeed) => void;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, justifyContent: "center" }}>
      <span className="text-muted" data-testid="current-time" style={{ fontVariantNumeric: "tabular-nums", minWidth: 40 }}>
        {formatTime(currentTime)}
      </span>

      <button className="btn btn-secondary" onClick={onRewind5} title="Rewind 5 seconds">
        ⏪ 5s
      </button>
      <button className="btn btn-secondary" onClick={onPrevLine} title="Previous line">
        ⏮ Line
      </button>
      <button className="btn" onClick={isPlaying ? onPause : onPlay} style={{ minWidth: 90 }}>
        {isPlaying ? "Pause" : "Play"}
      </button>
      <button className="btn btn-secondary" onClick={onNextLine} title="Next line">
        Line ⏭
      </button>
      <button className="btn btn-secondary" onClick={onReplayLine} title="Replay current line">
        ↻ Line
      </button>

      <span className="text-muted" style={{ fontVariantNumeric: "tabular-nums", minWidth: 40 }}>
        {formatTime(durationSec)}
      </span>

      <div style={{ display: "flex", gap: 4, marginLeft: 12 }}>
        {playbackSpeeds.map((speed) => (
          <button
            key={speed}
            onClick={() => onSetSpeed(speed)}
            className={playbackRate === speed ? "btn" : "btn btn-secondary"}
            style={{ padding: "6px 10px", fontSize: 13 }}
          >
            {speed}×
          </button>
        ))}
      </div>
    </div>
  );
}
