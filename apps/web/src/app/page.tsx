"use client";

import { formatRelativeTime, isValidYoutubeUrl } from "@singlearn/shared";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  createSongFromYoutube,
  listSongs,
  uploadAudio,
  type CreateSongResponse,
  type LibrarySongSummary,
} from "@/lib/apiClient";

export default function HomePage() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [identifying, setIdentifying] = useState(false);
  const [identified, setIdentified] = useState<CreateSongResponse | null>(null);
  const [uploading, setUploading] = useState(false);
  const [songs, setSongs] = useState<LibrarySongSummary[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listSongs()
      .then(setSongs)
      .catch(() => setSongs([]));
  }, []);

  async function handleCreateKaraoke() {
    setError(null);
    if (!isValidYoutubeUrl(url)) {
      setError("That doesn't look like a YouTube link. Try pasting a full youtube.com or youtu.be URL.");
      return;
    }
    setIdentifying(true);
    try {
      const result = await createSongFromYoutube(url);
      setIdentified(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong identifying that song.");
    } finally {
      setIdentifying(false);
    }
  }

  async function handleFileSelected(file: File) {
    if (!identified) return;
    setError(null);
    setUploading(true);
    try {
      const result = await uploadAudio(identified.songId, file);
      router.push(`/songs/${identified.songId}/processing${result.reused ? "?reused=1" : ""}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not upload that audio file.");
      setUploading(false);
    }
  }

  return (
    <main className="container">
      <div style={{ textAlign: "center", marginTop: 48, marginBottom: 40 }}>
        <h1 style={{ fontSize: 40, marginBottom: 8 }}>Learn any song</h1>
        <p className="text-muted" style={{ fontSize: 17 }}>
          Karaoke lyrics, isolated vocals, and pitch guidance to help you learn the words and the melody.
        </p>
      </div>

      <div className="card" style={{ maxWidth: 640, margin: "0 auto" }}>
        {!identified ? (
          <>
            <label htmlFor="youtube-url" style={{ display: "block", marginBottom: 8, fontWeight: 600 }}>
              Paste a YouTube link
            </label>
            <input
              id="youtube-url"
              className="input"
              placeholder="https://www.youtube.com/watch?v=..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateKaraoke()}
            />
            <button
              className="btn"
              style={{ marginTop: 16, width: "100%" }}
              onClick={handleCreateKaraoke}
              disabled={identifying || url.trim().length === 0}
            >
              {identifying ? "Identifying song…" : "Create Karaoke"}
            </button>
            {error && (
              <p style={{ color: "var(--danger)", marginTop: 12, marginBottom: 0 }}>{error}</p>
            )}
          </>
        ) : (
          <>
            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
              {identified.thumbnailUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={identified.thumbnailUrl}
                  alt=""
                  width={120}
                  height={68}
                  style={{ borderRadius: 8, objectFit: "cover" }}
                />
              )}
              <div>
                <div style={{ fontWeight: 600, fontSize: 17 }}>{identified.title}</div>
                {identified.artist && <div className="text-muted">{identified.artist}</div>}
              </div>
            </div>

            <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "20px 0" }} />

            <p style={{ marginTop: 0 }}>
              To process this song, SingLearn needs audio you own or have permission to use — YouTube&apos;s
              terms don&apos;t allow extracting audio from the video itself.{" "}
              <span className="text-muted">(This is enforced server-side; see README for details.)</span>
            </p>
            <input
              ref={fileInputRef}
              type="file"
              data-testid="audio-file-input"
              accept="audio/*,video/mp4,video/webm,video/quicktime"
              style={{ display: "none" }}
              onChange={(e) => e.target.files?.[0] && handleFileSelected(e.target.files[0])}
            />
            <button className="btn" style={{ width: "100%" }} onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? "Uploading…" : "Upload authorized audio file"}
            </button>
            <button
              className="btn btn-secondary"
              style={{ width: "100%", marginTop: 8 }}
              onClick={() => setIdentified(null)}
              disabled={uploading}
            >
              Back
            </button>
            {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
          </>
        )}
      </div>

      {songs.length > 0 && (
        <div style={{ marginTop: 56 }}>
          <h2 style={{ fontSize: 20, marginBottom: 16 }}>Your songs</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
            {songs.map((song) => (
              <a
                key={song.id}
                href={song.status === "complete" ? `/songs/${song.id}/practice` : `/songs/${song.id}/processing`}
                className="card"
                style={{ display: "block", textDecoration: "none" }}
              >
                {song.thumbnailUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={song.thumbnailUrl}
                    alt=""
                    style={{ width: "100%", aspectRatio: "16/9", objectFit: "cover", borderRadius: 8, marginBottom: 12 }}
                  />
                )}
                <div style={{ fontWeight: 600 }}>{song.title}</div>
                {song.artist && <div className="text-muted" style={{ fontSize: 14 }}>{song.artist}</div>}
                <div className="badge" style={{ marginTop: 8 }}>
                  {song.status === "complete" ? "Ready to practice" : song.status === "failed" ? "Failed" : "Processing…"}
                </div>
                {song.practiceSummary.sessionCount > 0 && (
                  <div className="text-muted" style={{ fontSize: 12, marginTop: 6 }}>
                    Practiced {song.practiceSummary.sessionCount}x
                    {song.practiceSummary.lastPracticedAt && (
                      <> · last {formatRelativeTime(song.practiceSummary.lastPracticedAt)}</>
                    )}
                  </div>
                )}
              </a>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
