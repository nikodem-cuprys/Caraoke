"use client";

import { findActiveSection } from "@singlearn/shared";
import type { SongDTO } from "@singlearn/shared";
import { use, useEffect, useState } from "react";
import { correctWord, getSong } from "@/lib/apiClient";
import { usePlayer } from "@/lib/usePlayer";
import { useMicrophonePitch } from "@/lib/useMicrophonePitch";
import { LyricsView } from "@/components/LyricsView";
import { PitchVisualizer } from "@/components/PitchVisualizer";
import { MicPracticePanel } from "@/components/MicPracticePanel";
import { PracticeControls } from "@/components/PracticeControls";
import { Mixer } from "@/components/Mixer";
import { Waveform } from "@/components/Waveform";
import { DifficultPartsPanel } from "@/components/DifficultPartsPanel";

export default function PracticePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [song, setSong] = useState<SongDTO | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSong(id)
      .then(setSong)
      .catch(() => setError("Could not load this song."));
  }, [id]);

  if (error) {
    return (
      <main className="container">
        <p style={{ color: "var(--danger)" }}>{error}</p>
      </main>
    );
  }

  if (!song) {
    return (
      <main className="container">
        <p className="text-muted">Loading…</p>
      </main>
    );
  }

  if (song.processingJob.status !== "complete") {
    return (
      <main className="container">
        <p className="text-muted">
          This song is still processing.{" "}
          <a href={`/songs/${id}/processing`} style={{ color: "var(--accent)" }}>
            View progress
          </a>
        </p>
      </main>
    );
  }

  return <Player song={song} editMode={editMode} onToggleEditMode={() => setEditMode((v) => !v)} onSongChanged={setSong} />;
}

function Player({
  song,
  editMode,
  onToggleEditMode,
  onSongChanged,
}: {
  song: SongDTO;
  editMode: boolean;
  onToggleEditMode: () => void;
  onSongChanged: (song: SongDTO) => void;
}) {
  const player = usePlayer(song);
  const mic = useMicrophonePitch(player.getCurrentTime);
  const activeSection = findActiveSection(song.sections, player.currentTime);

  async function handleCorrectWord(wordId: string, text: string) {
    // Optimistic update: only the word's text changes, timing/sync is untouched.
    onSongChanged({
      ...song,
      lines: song.lines.map((line) => ({
        ...line,
        words: line.words.map((w) => (w.id === wordId ? { ...w, text, isUserCorrected: true } : w)),
      })),
    });
    try {
      await correctWord(song.id, wordId, text);
    } catch {
      // Reload from server on failure to avoid a stuck local-only edit.
      getSong(song.id).then(onSongChanged);
    }
  }

  return (
    <main className="container" style={{ maxWidth: 900 }}>
      <audio ref={player.refs.referenceRef} src={player.stemsAvailable ? undefined : song.assets.reference ?? undefined} preload="auto" />
      <audio ref={player.refs.vocalsRef} src={player.stemsAvailable ? song.assets.vocals ?? undefined : undefined} preload="auto" />
      <audio
        ref={player.refs.instrumentalRef}
        src={player.stemsAvailable ? song.assets.instrumental ?? undefined : undefined}
        preload="auto"
      />

      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 20 }}>{song.title}</div>
          {song.artist && <div className="text-muted">{song.artist}</div>}
        </div>
        <div style={{ textAlign: "right" }}>
          {activeSection && <div className="badge">{activeSection.label}</div>}
          <button className="btn btn-secondary" style={{ marginTop: 8, fontSize: 12, padding: "6px 12px" }} onClick={onToggleEditMode}>
            {editMode ? "Done editing" : "Edit lyrics"}
          </button>
        </div>
      </header>

      <div className="card" style={{ marginBottom: 16 }}>
        <LyricsView
          lines={song.lines}
          currentTime={player.currentTime}
          activeLine={player.activeLine}
          editMode={editMode}
          onCorrectWord={handleCorrectWord}
          onLoopLine={(line) => player.loopLine(line)}
          onSeekLine={(line) => player.seek(line.start)}
        />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <PitchVisualizer
          notes={song.melodyNotes}
          currentTime={player.currentTime}
          liveUserSamples={mic.permission === "granted" ? mic.samplesRef.current : undefined}
        />
        <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "16px 0" }} />
        <MicPracticePanel
          permission={mic.permission}
          error={mic.error}
          latest={mic.latest}
          start={mic.start}
          stop={mic.stop}
          clearHistory={mic.clearHistory}
          samplesRef={mic.samplesRef}
          melodyNotes={song.melodyNotes}
          lines={song.lines}
        />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <Waveform
          waveform={song.waveform}
          sections={song.sections}
          durationSec={song.durationSec}
          currentTime={player.currentTime}
          onSeek={player.seek}
        />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <PracticeControls
          isPlaying={player.isPlaying}
          currentTime={player.currentTime}
          durationSec={song.durationSec}
          playbackRate={player.playbackRate}
          playbackSpeeds={player.playbackSpeeds}
          onPlay={player.play}
          onPause={player.pause}
          onPrevLine={player.previousLine}
          onNextLine={player.nextLine}
          onRewind5={player.rewind5}
          onReplayLine={player.replayCurrentLine}
          onSetSpeed={player.setPlaybackRate}
        />
        {player.loop.kind && (
          <div style={{ textAlign: "center", marginTop: 12 }}>
            <span className="badge">
              Looping {player.loop.kind} ({Math.round(player.loop.prerollSec * 10) / 10}s pre-roll)
            </span>{" "}
            <button className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: 12 }} onClick={player.clearLoop}>
              Stop looping
            </button>
            <div style={{ marginTop: 8 }}>
              <input
                type="range"
                min={0}
                max={3}
                step={0.5}
                value={player.loop.prerollSec}
                onChange={(e) => player.setLoopPreroll(parseFloat(e.target.value))}
              />
            </div>
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div className="card">
          <h3 style={{ marginTop: 0, fontSize: 15 }}>Mixer</h3>
          <Mixer
            stemsAvailable={player.stemsAvailable}
            separationEngine={song.assets.separationEngine}
            preset={player.mixerPreset}
            vocalsVolume={player.vocalsVolume}
            instrumentalVolume={player.instrumentalVolume}
            onApplyPreset={player.applyMixerPreset}
            onCustomVolumes={player.setCustomVolumes}
          />
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0, fontSize: 15 }}>Song insights</h3>
          {song.vocalRange && (
            <p style={{ fontSize: 13 }}>
              Vocal range: <strong>{song.vocalRange.lowestNote}</strong> – <strong>{song.vocalRange.highestNote}</strong> (
              {song.vocalRange.semitoneRange} semitones)
            </p>
          )}
          {song.keyEstimate && (
            <p style={{ fontSize: 13 }}>
              Estimated key: <strong>{song.keyEstimate.tonic} {song.keyEstimate.mode}</strong>{" "}
              <span className="text-muted">({Math.round(song.keyEstimate.confidence * 100)}% confidence, estimate)</span>
            </p>
          )}
          <h4 style={{ fontSize: 13, marginBottom: 8 }}>Difficult parts</h4>
          <DifficultPartsPanel parts={song.difficultParts} onLoop={(part) => player.loopRegion({ start: part.start, end: part.end })} />
        </div>
      </div>
    </main>
  );
}
