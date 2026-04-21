import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ValidationError, validatePublishInput } from "../src/domain/validation";

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

  test("rejects more than 4 photos when x is selected", () => {
    expect(() =>
      validatePublishInput({
        kind: "photos",
        caption: "Too many for X",
        platforms: {
          x: true,
          instagram: true,
        },
        media: [
          "https://example.com/1.jpg",
          "https://example.com/2.jpg",
          "https://example.com/3.jpg",
          "https://example.com/4.jpg",
          "https://example.com/5.jpg",
        ],
      }),
    ).toThrow(ValidationError);
  });

  test("rejects more than 10 photos when instagram is selected", () => {
    expect(() =>
      validatePublishInput({
        kind: "photos",
        caption: "Too many for Instagram",
        platforms: {
          instagram: true,
        },
        media: Array.from({ length: 11 }, (_, index) => `https://example.com/${index + 1}.jpg`),
      }),
    ).toThrow(ValidationError);
  });

  test("rejects local X photos above the supported size limit", () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), "upload-post-publisher-"));
    const oversizedImagePath = join(tempDirectory, "oversized.jpg");

    try {
      writeFileSync(oversizedImagePath, Buffer.alloc((5 * 1024 * 1024) + 1));

      expect(() =>
        validatePublishInput({
          kind: "photos",
          caption: "Oversized local file",
          platforms: {
            x: true,
          },
          media: [oversizedImagePath],
        }),
      ).toThrow(ValidationError);
    } finally {
      rmSync(tempDirectory, { force: true, recursive: true });
    }
  });
});
