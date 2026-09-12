"use client";

import type { SongDTO } from "@singlearn/shared";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSong } from "@/lib/apiClient";
import { useJobStream } from "@/lib/useJobStream";
import { ProcessingStages } from "@/components/ProcessingStages";

export default function ProcessingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [song, setSong] = useState<SongDTO | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    getSong(id)
      .then(setSong)
      .catch(() => setLoadError("Could not load this song."));
  }, [id]);

  const jobId = song?.processingJob.id || null;
  const { job } = useJobStream(jobId);
  const effectiveJob = job ?? song?.processingJob ?? null;

  useEffect(() => {
    if (effectiveJob?.status === "complete") {
      const timeout = setTimeout(() => router.push(`/songs/${id}/practice`), 600);
      return () => clearTimeout(timeout);
    }
  }, [effectiveJob?.status, id, router]);

  if (loadError) {
    return (
      <main className="container">
        <p style={{ color: "var(--danger)" }}>{loadError}</p>
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

  return (
    <main className="container" style={{ maxWidth: 640 }}>
      <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 24 }}>
        {song.thumbnailUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={song.thumbnailUrl} alt="" width={120} height={68} style={{ borderRadius: 8, objectFit: "cover" }} />
        )}
        <div>
          <div style={{ fontWeight: 600, fontSize: 18 }}>{song.title}</div>
          {song.artist && <div className="text-muted">{song.artist}</div>}
        </div>
      </div>

      <div className="card">
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Building your karaoke project</h2>
        {effectiveJob && effectiveJob.stages.length > 0 ? (
          <ProcessingStages stages={effectiveJob.stages} />
        ) : (
          <p className="text-muted">Waiting for the processing job to start…</p>
        )}

        {effectiveJob?.status === "failed" && (
          <p style={{ color: "var(--danger)", marginTop: 16 }}>
            Processing failed. Check the stage above with an error for details, or try uploading the audio again.
          </p>
        )}
        {effectiveJob?.status === "complete" && (
          // var(--text), not var(--accent): the accent is the red brand/
          // attention color, and this is a success message, not a warning.
          <p style={{ color: "var(--text)", marginTop: 16 }}>Done! Taking you to the karaoke player…</p>
        )}
      </div>
    </main>
  );
}
