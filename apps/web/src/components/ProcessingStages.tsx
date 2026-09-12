import type { ProcessingStage } from "@singlearn/shared";

const STAGE_LABELS: Record<string, string> = {
  FETCH_METADATA: "Identifying song",
  VALIDATE_AUDIO_SOURCE: "Validating authorized audio",
  PREPARE_AUDIO: "Preparing audio",
  SEPARATE_STEMS: "Separating vocals & instrumental",
  TRANSCRIBE: "Transcribing lyrics",
  ALIGN_WORDS: "Synchronizing words",
  DETECT_PITCH: "Detecting melody",
  SIMPLIFY_MELODY: "Simplifying melody into target notes",
  SEGMENT_LYRICS: "Grouping lyrics into lines & sections",
  GENERATE_WAVEFORM: "Building waveform",
  BUILD_KARAOKE: "Building karaoke project",
  COMPLETE: "Done",
};

function StageIcon({ status }: { status: ProcessingStage["status"] }) {
  // var(--text), not var(--accent): the accent is the red brand/attention
  // color, and a red checkmark for a successfully-completed stage would
  // read as an error.
  if (status === "done") return <span style={{ color: "var(--text)" }}>✓</span>;
  if (status === "failed") return <span style={{ color: "var(--danger)" }}>✕</span>;
  if (status === "running")
    return (
      <span className="text-muted" aria-label="running">
        …
      </span>
    );
  if (status === "skipped") return <span className="text-muted">–</span>;
  return <span className="text-muted">○</span>;
}

export function ProcessingStages({ stages }: { stages: ProcessingStage[] }) {
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {stages.map((stage) => (
        <li
          key={stage.name}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            padding: "10px 0",
            borderBottom: "1px solid var(--border)",
            opacity: stage.status === "pending" ? 0.55 : 1,
          }}
        >
          <span style={{ width: 20, textAlign: "center", flexShrink: 0, fontFamily: "monospace" }}>
            <StageIcon status={stage.status} />
          </span>
          <div>
            <div style={{ fontWeight: stage.status === "running" ? 600 : 400 }}>
              {STAGE_LABELS[stage.name] ?? stage.name}
            </div>
            {stage.detail && <div className="text-muted" style={{ fontSize: 13 }}>{stage.detail}</div>}
            {stage.error && <div style={{ color: "var(--danger)", fontSize: 13 }}>{stage.error}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}
