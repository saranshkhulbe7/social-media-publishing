import { describe, expect, test } from "bun:test";

import { ValidationError, validatePublishInput } from "../src/domain/validation.ts";

describe("validatePublishInput", () => {
  test("accepts text payloads for x only", () => {
    const result = validatePublishInput({
      kind: "text",
      caption: "Hello, X.",
      platforms: {
        x: true,
      },
    });

    expect(result.requestedPlatforms).toEqual(["x"]);
    expect(result.publishablePlatforms).toEqual(["x"]);
    expect(result.media).toEqual([]);
  });

  test("accepts photo payloads with image URLs", () => {
    const result = validatePublishInput({
      kind: "photos",
      caption: "Photos",
      platforms: {
        x: true,
        instagram: true,
        facebook: true,
      },
      media: ["https://example.com/photo-1.jpg", "https://example.com/photo-2.png"],
    });

    expect(result.kind).toBe("photos");
    expect(result.requestedPlatforms).toEqual(["x", "instagram", "facebook"]);
  });

  test("rejects payloads when no platform is selected", () => {
    expect(() =>
      validatePublishInput({
        kind: "photos",
        caption: "Photos",
        media: ["https://example.com/photo-1.jpg"],
      }),
    ).toThrow(ValidationError);
  });

  test("rejects mixed media in photo payloads", () => {
    expect(() =>
      validatePublishInput({
        kind: "photos",
        caption: "Mixed",
        platforms: {
          x: true,
          instagram: true,
        },
        media: ["https://example.com/photo.jpg", "https://example.com/video.mp4"],
      }),
    ).toThrow(ValidationError);
  });

  test("rejects image payloads in video mode", () => {
    expect(() =>
      validatePublishInput({
        kind: "video",
        caption: "Not a video",
        platforms: {
          instagram: true,
        },
        media: "https://example.com/photo.jpg",
      }),
    ).toThrow(ValidationError);
  });
});
