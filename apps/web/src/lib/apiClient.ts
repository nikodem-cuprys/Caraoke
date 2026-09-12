import type { PracticeSummaryDTO, SongDTO } from "@singlearn/shared";
import { getClientId } from "./clientId";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4100";

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      "X-Client-Id": getClientId(),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error ?? `Request failed with status ${res.status}`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface CreateSongResponse {
  songId: string;
  title: string;
  artist: string | null;
  thumbnailUrl: string | null;
  youtubeVideoId: string | null;
  audioRequired: boolean;
}

export function createSongFromYoutube(youtubeUrl: string): Promise<CreateSongResponse> {
  return request("/api/songs", { method: "POST", body: JSON.stringify({ youtubeUrl }) });
}

export async function uploadAudio(songId: string, file: File): Promise<{ reused: boolean; jobId?: string }> {
  const form = new FormData();
  form.append("audio", file);
  return request(`/api/songs/${songId}/audio`, { method: "POST", body: form });
}

export function getSong(songId: string): Promise<SongDTO> {
  return request(`/api/songs/${songId}`);
}

export interface LibrarySongSummary {
  id: string;
  title: string;
  artist: string | null;
  thumbnailUrl: string | null;
  durationSec: number;
  status: string;
  createdAt: string;
  practiceSummary: PracticeSummaryDTO;
}

export function listSongs(): Promise<LibrarySongSummary[]> {
  return request("/api/songs");
}

export function correctWord(songId: string, wordId: string, text: string): Promise<void> {
  return request(`/api/songs/${songId}/words/${wordId}`, { method: "PATCH", body: JSON.stringify({ text }) });
}

export function overrideLanguage(songId: string, language: string): Promise<void> {
  return request(`/api/songs/${songId}/language`, { method: "PATCH", body: JSON.stringify({ language }) });
}

export function editSection(
  songId: string,
  sectionId: string,
  patch: Partial<{ type: string; label: string; start: number; end: number }>
): Promise<void> {
  return request(`/api/songs/${songId}/sections/${sectionId}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function startPracticeSession(songId: string): Promise<{ id: string }> {
  return request(`/api/songs/${songId}/practice-sessions`, { method: "POST" });
}

/** Heartbeat/end: extends the session's endedAt to now. See usePracticeSession.ts for why this is called repeatedly rather than once at the end. */
export function pingPracticeSession(songId: string, sessionId: string): Promise<void> {
  return request(`/api/songs/${songId}/practice-sessions/${sessionId}`, { method: "PATCH" });
}

export function jobStreamUrl(jobId: string): string {
  return `${API_BASE}/api/jobs/${jobId}/stream`;
}

export { API_BASE };
