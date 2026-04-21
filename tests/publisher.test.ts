import { describe, expect, test } from "bun:test";

import { createPublisherService } from "../src/index";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

describe("publisher service", () => {
  test("publishes text to x and marks instagram as skipped", async () => {
    const requests: Array<{ url: string; body?: FormData }> = [];
    const service = createPublisherService({
      apiKey: "test-key",
      baseUrl: "https://api.upload-post.com/api",
      profile: "demo-profile",
      pollIntervalMs: 1,
      pollTimeoutMs: 100,
      fetchImpl: async (input, init) => {
        requests.push({
          url: input.toString(),
          body: init?.body as FormData | undefined,
        });

        return jsonResponse({
          success: true,
          results: {
            x: {
              success: true,
              url: "https://x.com/example/status/1",
            },
          },
        });
      },
    });

    const result = await service.publish(
      {
        kind: "text",
        caption: "Ship it.",
      },
      {
        x: true,
      },
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("https://api.upload-post.com/api/upload_text");
    expect(requests[0]!.body?.getAll("platform[]")).toEqual(["x"]);
    expect(result.overallStatus).toBe("success");
    expect(result.platforms.x.status).toBe("published");
    expect(result.platforms.instagram.status).toBe("skipped");
    expect(result.platforms.instagram.reason).toBe("not_requested");
  });

  test("routes photos to upload_photos for x and instagram", async () => {
    const requests: Array<{ url: string; body?: FormData }> = [];
    const service = createPublisherService({
      apiKey: "test-key",
      baseUrl: "https://api.upload-post.com/api",
      profile: "demo-profile",
      pollIntervalMs: 1,
      pollTimeoutMs: 100,
      fetchImpl: async (input, init) => {
        requests.push({
          url: input.toString(),
          body: init?.body as FormData | undefined,
        });

        return jsonResponse({
          success: true,
          results: {
            x: {
              success: true,
              url: "https://x.com/example/status/2",
            },
            instagram: {
              success: true,
              url: "https://instagram.com/p/abc123",
            },
          },
        });
      },
    });

    const result = await service.publish(
      {
        kind: "photos",
        caption: "Gallery post",
        media: ["https://example.com/photo-1.jpg", "https://example.com/photo-2.png"],
      },
      {
        x: true,
        instagram: true,
      },
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("https://api.upload-post.com/api/upload_photos");
    expect(requests[0]!.body?.getAll("platform[]")).toEqual(["x", "instagram"]);
    expect(requests[0]!.body?.getAll("photos[]")).toHaveLength(2);
    expect(result.overallStatus).toBe("success");
  });

  test("publishes video asynchronously and polls to completion", async () => {
    const requests: Array<{ url: string; body?: FormData }> = [];
    let callCount = 0;

    const service = createPublisherService({
      apiKey: "test-key",
      baseUrl: "https://api.upload-post.com/api",
      profile: "demo-profile",
      pollIntervalMs: 1,
      pollTimeoutMs: 100,
      fetchImpl: async (input, init) => {
        callCount += 1;
        requests.push({
          url: input.toString(),
          body: init?.body as FormData | undefined,
        });

        if (callCount === 1) {
          return jsonResponse({
            success: true,
            message: "Upload initiated successfully in background.",
            request_id: "req-video-1",
          });
        }

        return jsonResponse({
          request_id: "req-video-1",
          status: "completed",
          results: [
            {
              platform: "x",
              success: true,
              url: "https://x.com/example/status/3",
            },
            {
              platform: "instagram",
              success: true,
              url: "https://instagram.com/reel/xyz789",
            },
            {
              platform: "facebook",
              success: true,
              url: "https://facebook.com/example/videos/1",
            },
          ],
        });
      },
    });

    const result = await service.publish(
      {
        kind: "video",
        caption: "Launch reel",
        media: "https://example.com/reel.mp4",
        platformOverrides: {
          facebook: {
            pageId: "page-123",
          },
        },
      },
      {
        x: true,
        instagram: true,
        facebook: true,
      },
    );

    expect(requests).toHaveLength(2);
    expect(requests[0]!.url).toBe("https://api.upload-post.com/api/upload");
    expect(requests[0]!.body?.get("media_type")).toBe("REELS");
    expect(requests[0]!.body?.get("share_to_feed")).toBe("true");
    expect(requests[0]!.body?.getAll("platform[]")).toEqual([
      "x",
      "instagram",
      "facebook",
    ]);
    expect(requests[0]!.body?.get("facebook_page_id")).toBe("page-123");
    expect(requests[1]!.url).toBe(
      "https://api.upload-post.com/api/uploadposts/status?request_id=req-video-1",
    );
    expect(result.overallStatus).toBe("success");
    expect(result.requestId).toBe("req-video-1");
    expect(result.platforms.facebook.status).toBe("published");
  });

  test("fails fast on mixed photo and video payloads without calling the api", async () => {
    let callCount = 0;
    const service = createPublisherService({
      apiKey: "test-key",
      baseUrl: "https://api.upload-post.com/api",
      profile: "demo-profile",
      pollIntervalMs: 1,
      pollTimeoutMs: 100,
      fetchImpl: async () => {
        callCount += 1;
        return jsonResponse({});
      },
    });

    const result = await service.publish(
      {
        kind: "photos",
        caption: "Mixed payload",
        media: ["https://example.com/photo.jpg", "https://example.com/video.mp4"],
      },
      {
        x: true,
        instagram: true,
      },
    );

    expect(callCount).toBe(0);
    expect(result.overallStatus).toBe("failed");
    expect(result.error?.code).toBe("validation_error");
  });

  test("normalizes authentication failures", async () => {
    const service = createPublisherService({
      apiKey: "bad-key",
      baseUrl: "https://api.upload-post.com/api",
      profile: "demo-profile",
      pollIntervalMs: 1,
      pollTimeoutMs: 100,
      fetchImpl: async () =>
        jsonResponse(
          {
            success: false,
            message: "Invalid or expired token",
          },
          401,
        ),
    });

    const result = await service.publish(
      {
        kind: "video",
        caption: "Launch reel",
        media: "https://example.com/reel.mp4",
      },
      {
        x: true,
        instagram: true,
      },
    );

    expect(result.overallStatus).toBe("failed");
    expect(result.error?.code).toBe("authentication_error");
    expect(result.platforms.x.status).toBe("failed");
    expect(result.platforms.instagram.status).toBe("failed");
  });

  test("normalizes daily platform cap violations", async () => {
    const service = createPublisherService({
      apiKey: "test-key",
      baseUrl: "https://api.upload-post.com/api",
      profile: "demo-profile",
      pollIntervalMs: 1,
      pollTimeoutMs: 100,
      fetchImpl: async () =>
        jsonResponse(
          {
            success: false,
            message: "Post verification failed",
            violations: [
              {
                platform: "instagram",
                type: "hard_cap",
                message: "Daily cap reached for instagram: 50/50 in last 24h",
                used_last_24h: 50,
                cap: 50,
              },
            ],
          },
          429,
        ),
    });

    const result = await service.publish(
      {
        kind: "photos",
        caption: "Cap reached",
        media: ["https://example.com/photo-1.jpg"],
      },
      {
        instagram: true,
      },
    );

    expect(result.overallStatus).toBe("failed");
    expect(result.error?.code).toBe("daily_platform_limit_exceeded");
    expect(result.error?.platform).toBe("instagram");
    expect(result.error?.retryable).toBe(true);
    expect(result.error?.violations?.[0]?.type).toBe("hard_cap");
  });

  test("normalizes monthly limit responses", async () => {
    const service = createPublisherService({
      apiKey: "test-key",
      baseUrl: "https://api.upload-post.com/api",
      profile: "demo-profile",
      pollIntervalMs: 1,
      pollTimeoutMs: 100,
      fetchImpl: async () =>
        jsonResponse(
          {
            success: false,
            message: "This upload would exceed your monthly limit.",
            usage: {
              count: 10,
              limit: 10,
              last_reset: "2026-04-01T00:00:00.000Z",
            },
          },
          429,
        ),
    });

    const result = await service.publish(
      {
        kind: "text",
        caption: "Limit test",
      },
      {
        x: true,
      },
    );

    expect(result.overallStatus).toBe("failed");
    expect(result.error?.code).toBe("monthly_limit_exceeded");
    expect(result.error?.usage?.limit).toBe(10);
  });

  test("routes photos to instagram only when x is disabled", async () => {
    const requests: Array<{ url: string; body?: FormData }> = [];
    const service = createPublisherService({
      apiKey: "test-key",
      baseUrl: "https://api.upload-post.com/api",
      profile: "demo-profile",
      pollIntervalMs: 1,
      pollTimeoutMs: 100,
      fetchImpl: async (input, init) => {
        requests.push({
          url: input.toString(),
          body: init?.body as FormData | undefined,
        });

        return jsonResponse({
          success: true,
          results: {
            instagram: {
              success: true,
              url: "https://instagram.com/p/ig-only",
            },
          },
        });
      },
    });

    const result = await service.publish(
      {
        kind: "photos",
        caption: "Instagram only post",
        media: ["https://example.com/photo-1.jpg"],
      },
      {
        instagram: true,
        x: false,
      },
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]!.body?.getAll("platform[]")).toEqual(["instagram"]);
    expect(result.requestedPlatforms).toEqual(["instagram"]);
    expect(result.platforms.instagram.status).toBe("published");
    expect(result.platforms.x.status).toBe("skipped");
  });

  test("publishes text to facebook only when requested", async () => {
    const requests: Array<{ url: string; body?: FormData }> = [];
    const service = createPublisherService({
      apiKey: "test-key",
      baseUrl: "https://api.upload-post.com/api",
      profile: "demo-profile",
      pollIntervalMs: 1,
      pollTimeoutMs: 100,
      fetchImpl: async (input, init) => {
        requests.push({
          url: input.toString(),
          body: init?.body as FormData | undefined,
        });

        return jsonResponse({
          success: true,
          results: {
            facebook: {
              success: true,
              url: "https://facebook.com/example/posts/42",
            },
          },
        });
      },
    });

    const result = await service.publish(
      {
        kind: "text",
        caption: "Facebook text post",
        platformOverrides: {
          facebook: {
            pageId: "page-42",
            linkUrl: "https://example.com/article",
          },
        },
      },
      {
        facebook: true,
      },
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("https://api.upload-post.com/api/upload_text");
    expect(requests[0]!.body?.getAll("platform[]")).toEqual(["facebook"]);
    expect(requests[0]!.body?.get("facebook_page_id")).toBe("page-42");
    expect(requests[0]!.body?.get("facebook_link_url")).toBe("https://example.com/article");
    expect(result.overallStatus).toBe("success");
    expect(result.platforms.facebook.status).toBe("published");
    expect(result.platforms.x.status).toBe("skipped");
  });

  test("marks instagram as skipped when explicitly requested for a text-only post", async () => {
    const service = createPublisherService({
      apiKey: "test-key",
      baseUrl: "https://api.upload-post.com/api",
      profile: "demo-profile",
      pollIntervalMs: 1,
      pollTimeoutMs: 100,
      fetchImpl: async () =>
        jsonResponse({
          success: true,
          results: {
            x: {
              success: true,
              url: "https://x.com/example/status/4",
            },
          },
        }),
    });

    const result = await service.publish(
      {
        kind: "text",
        caption: "Text post",
      },
      {
        x: true,
        instagram: true,
      },
    );

    expect(result.overallStatus).toBe("partial_failure");
    expect(result.platforms.x.status).toBe("published");
    expect(result.platforms.instagram.status).toBe("skipped");
    expect(result.platforms.instagram.reason).toBe("instagram_text_only_not_supported");
  });

  test("normalizes reconnect-required platform failures", async () => {
    const service = createPublisherService({
      apiKey: "test-key",
      baseUrl: "https://api.upload-post.com/api",
      profile: "demo-profile",
      pollIntervalMs: 1,
      pollTimeoutMs: 100,
      fetchImpl: async () =>
        jsonResponse({
          success: true,
          results: {
            instagram: {
              success: false,
              error:
                "Your Instagram session has expired. Please reconnect your Instagram account.",
            },
          },
        }),
    });

    const result = await service.publish(
      {
        kind: "photos",
        caption: "Reconnect needed",
        media: ["https://example.com/photo-1.jpg"],
      },
      {
        instagram: true,
      },
    );

    expect(result.overallStatus).toBe("failed");
    expect(result.platforms.instagram.status).toBe("failed");
    expect(result.platforms.instagram.error?.code).toBe("account_reconnect_required");
    expect(result.platforms.instagram.error?.retryable).toBe(false);
  });

  test("normalizes Facebook page selection failures with available pages", async () => {
    const service = createPublisherService({
      apiKey: "test-key",
      baseUrl: "https://api.upload-post.com/api",
      profile: "demo-profile",
      pollIntervalMs: 1,
      pollTimeoutMs: 100,
      fetchImpl: async () =>
        jsonResponse({
          success: true,
          results: {
            facebook: {
              success: false,
              error: "Multiple Facebook Pages found. Please select a Page.",
              available_pages: [
                { id: "1", name: "Page One" },
                { id: "2", name: "Page Two" },
              ],
            },
          },
        }),
    });

    const result = await service.publish(
      {
        kind: "text",
        caption: "Facebook page selection",
      },
      {
        facebook: true,
      },
    );

    expect(result.overallStatus).toBe("failed");
    expect(result.platforms.facebook.error?.code).toBe(
      "facebook_page_selection_required",
    );
    expect(result.platforms.facebook.error?.availablePages).toHaveLength(2);
  });

  test("normalizes temporary service failures as retryable", async () => {
    const service = createPublisherService({
      apiKey: "test-key",
      baseUrl: "https://api.upload-post.com/api",
      profile: "demo-profile",
      pollIntervalMs: 1,
      pollTimeoutMs: 100,
      fetchImpl: async () =>
        jsonResponse(
          {
            success: false,
            message: "Service Unavailable (503)",
          },
          503,
        ),
    });

    const result = await service.publish(
      {
        kind: "photos",
        caption: "Temporary failure",
        media: ["https://example.com/photo-1.jpg"],
      },
      {
        instagram: true,
      },
    );

    expect(result.overallStatus).toBe("failed");
    expect(result.error?.code).toBe("service_unavailable");
    expect(result.error?.retryable).toBe(true);
  });

  test("fails when publish is called without any enabled platforms", async () => {
    let callCount = 0;
    const service = createPublisherService({
      apiKey: "test-key",
      baseUrl: "https://api.upload-post.com/api",
      profile: "demo-profile",
      pollIntervalMs: 1,
      pollTimeoutMs: 100,
      fetchImpl: async () => {
        callCount += 1;
        return jsonResponse({});
      },
    });

    const result = await service.publish({
      kind: "photos",
      caption: "No platform selected",
      media: ["https://example.com/photo-1.jpg"],
    });

    expect(callCount).toBe(0);
    expect(result.overallStatus).toBe("failed");
    expect(result.error?.code).toBe("validation_error");
    expect(result.requestedPlatforms).toEqual([]);
  });
});
