"use client";

import { findActiveWord } from "@singlearn/shared";
import type { LyricLineDTO, LyricWordDTO } from "@singlearn/shared";
import { useState } from "react";

function Word({
  word,
  isActive,
  editMode,
  onCorrect,
}: {
  word: LyricWordDTO;
  isActive: boolean;
  editMode: boolean;
  onCorrect: (wordId: string, text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(word.text);

  if (editing) {
    return (
      <input
        autoFocus
        className="input"
        style={{ width: Math.max(60, draft.length * 12), display: "inline-block", padding: "2px 6px", margin: "0 2px" }}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft !== word.text) onCorrect(word.id, draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(word.text);
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <span
      onClick={() => editMode && setEditing(true)}
      title={word.lowConfidence ? "Possible transcription error — click to correct" : undefined}
      data-testid="lyric-word"
      data-word-id={word.id}
      data-active={isActive}
      style={{
        color: isActive ? "var(--accent)" : undefined,
        borderBottom: word.lowConfidence ? "2px dotted var(--warn)" : "2px solid transparent",
        cursor: editMode ? "text" : "default",
        transition: "color 0.1s ease",
      }}
    >
      {word.text}
    </span>
  );
}

function LineText({
  line,
  currentTime,
  editMode,
  onCorrect,
}: {
  line: LyricLineDTO;
  currentTime: number;
  editMode: boolean;
  onCorrect: (wordId: string, text: string) => void;
}) {
  const activeWord = findActiveWord(line.words, currentTime);
  return (
    <>
      {line.words.map((word, i) => (
        <span key={word.id}>
          <Word word={word} isActive={activeWord?.id === word.id} editMode={editMode} onCorrect={onCorrect} />
          {i < line.words.length - 1 ? " " : ""}
        </span>
      ))}
    </>
  );
}

export function LyricsView({
  lines,
  currentTime,
  activeLine,
  editMode,
  onCorrectWord,
  onLoopLine,
  onSeekLine,
}: {
  lines: LyricLineDTO[];
  currentTime: number;
  activeLine: LyricLineDTO | null;
  editMode: boolean;
  onCorrectWord: (wordId: string, text: string) => void;
  onLoopLine: (line: LyricLineDTO) => void;
  onSeekLine: (line: LyricLineDTO) => void;
}) {
  const idx = activeLine ? lines.findIndex((l) => l.id === activeLine.id) : lines.findIndex((l) => l.start > currentTime) - 1;
  const prevLine = idx > 0 ? lines[idx - 1] : null;
  const nextLine = idx >= 0 && idx + 1 < lines.length ? lines[idx + 1] : lines.find((l) => l.start > currentTime) ?? null;

  if (lines.length === 0) {
    return <p className="text-muted" style={{ textAlign: "center" }}>No lyrics detected yet.</p>;
  }

  return (
    <div style={{ textAlign: "center", padding: "24px 0" }}>
      <div className="text-muted" style={{ fontSize: 20, minHeight: 30, opacity: 0.6 }}>
        {prevLine ? <LineText line={prevLine} currentTime={currentTime} editMode={editMode} onCorrect={onCorrectWord} /> : " "}
      </div>

      <div
        data-testid="active-line"
        style={{ fontSize: 34, fontWeight: 700, margin: "16px 0", minHeight: 46, cursor: "pointer" }}
        onClick={() => activeLine && onSeekLine(activeLine)}
        onDoubleClick={() => activeLine && onLoopLine(activeLine)}
        title={activeLine ? "Click to seek, double-click to loop this line" : undefined}
      >
        {activeLine ? (
          <LineText line={activeLine} currentTime={currentTime} editMode={editMode} onCorrect={onCorrectWord} />
        ) : (
          " "
        )}
      </div>

      <div className="text-muted" style={{ fontSize: 20, minHeight: 30, opacity: 0.6 }}>
        {nextLine ? <LineText line={nextLine} currentTime={currentTime} editMode={editMode} onCorrect={onCorrectWord} /> : " "}
      </div>

      {activeLine && (
        <button className="btn btn-secondary" style={{ marginTop: 16 }} onClick={() => onLoopLine(activeLine)}>
          Loop this line
        </button>
      )}
    </div>
  );
}
