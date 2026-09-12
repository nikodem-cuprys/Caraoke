import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("../youtube/fetchYoutubeMetadata", () => ({
  fetchYoutubeMetadata: vi.fn(async () => ({
    videoId: "dQw4w9WgXcQ",
    canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    title: "Test Song",
    authorName: "Test Artist",
    thumbnailUrl: null,
  })),
}));

import { createApp } from "../app";
import { resetDb } from "./testUtils";

const app = createApp();

describe("processing job rate limiting", () => {
  it("allows a small burst then rejects further song-creation requests from the same client", async () => {
    await resetDb();
    const clientId = `rate-limit-client-${Date.now()}`;
    let sawRateLimit = false;
    for (let i = 0; i < 8; i++) {
      const res = await request(app)
        .post("/api/songs")
        .set("X-Client-Id", clientId)
        .send({ youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
      if (res.status === 429) {
        sawRateLimit = true;
        break;
      }
      expect(res.status).toBe(201);
    }
    expect(sawRateLimit).toBe(true);
  });
});
