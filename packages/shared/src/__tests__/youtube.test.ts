import { describe, expect, it } from "vitest";
import { InvalidYoutubeUrlError, isValidYoutubeUrl, parseYoutubeUrl } from "../youtube";

describe("parseYoutubeUrl", () => {
  it("parses a standard watch URL", () => {
    const result = parseYoutubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(result.videoId).toBe("dQw4w9WgXcQ");
    expect(result.canonicalUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("parses a watch URL with extra query params", () => {
    const result = parseYoutubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=abc&t=30s");
    expect(result.videoId).toBe("dQw4w9WgXcQ");
  });

  it("parses a youtu.be short link", () => {
    const result = parseYoutubeUrl("https://youtu.be/dQw4w9WgXcQ");
    expect(result.videoId).toBe("dQw4w9WgXcQ");
  });

  it("parses a youtu.be short link with query params", () => {
    const result = parseYoutubeUrl("https://youtu.be/dQw4w9WgXcQ?t=5");
    expect(result.videoId).toBe("dQw4w9WgXcQ");
  });

  it("parses a shorts URL", () => {
    const result = parseYoutubeUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ");
    expect(result.videoId).toBe("dQw4w9WgXcQ");
  });

  it("parses an embed URL", () => {
    const result = parseYoutubeUrl("https://www.youtube.com/embed/dQw4w9WgXcQ");
    expect(result.videoId).toBe("dQw4w9WgXcQ");
  });

  it("rejects a non-YouTube host (SSRF guard)", () => {
    expect(() => parseYoutubeUrl("https://evil.com/watch?v=dQw4w9WgXcQ")).toThrow(InvalidYoutubeUrlError);
  });

  it("rejects a lookalike host", () => {
    expect(() => parseYoutubeUrl("https://www.youtube.com.evil.com/watch?v=dQw4w9WgXcQ")).toThrow(
      InvalidYoutubeUrlError
    );
  });

  it("rejects malformed URLs", () => {
    expect(() => parseYoutubeUrl("not a url")).toThrow(InvalidYoutubeUrlError);
  });

  it("rejects a watch URL with a missing/short video id", () => {
    expect(() => parseYoutubeUrl("https://www.youtube.com/watch?v=short")).toThrow(InvalidYoutubeUrlError);
  });

  it("rejects a watch URL with no v param", () => {
    expect(() => parseYoutubeUrl("https://www.youtube.com/watch")).toThrow(InvalidYoutubeUrlError);
  });

  it("rejects non-http(s) protocols", () => {
    expect(() => parseYoutubeUrl("javascript:alert(1)")).toThrow(InvalidYoutubeUrlError);
  });
});

describe("isValidYoutubeUrl", () => {
  it("returns booleans instead of throwing", () => {
    expect(isValidYoutubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
    expect(isValidYoutubeUrl("https://evil.com")).toBe(false);
  });
});
