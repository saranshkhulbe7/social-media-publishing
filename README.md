# @saranshkhulbe/upload-post-publisher

Clean TypeScript package for publishing to X, Instagram, and Facebook through the Upload Post API.

This package is built as a reusable npm library, not as a CLI. A consumer installs it, sets environment variables, and calls `publish()` with platform booleans such as `{ x: true, instagram: true, facebook: false }`.

## Install

With npm:

```bash
npm install @saranshkhulbe/upload-post-publisher
```

With Bun:

```bash
bun add @saranshkhulbe/upload-post-publisher
```

## Quick Start

Set these environment variables:

```bash
export UPLOAD_POST_API_KEY="your-upload-post-api-key"
export UPLOAD_POST_PROFILE="your-upload-post-profile"
```

Optional environment variables:

```bash
export UPLOAD_POST_BASE_URL="https://api.upload-post.com/api"
export UPLOAD_POST_POLL_INTERVAL_MS="1000"
export UPLOAD_POST_POLL_TIMEOUT_MS="60000"
```

Create a script like this:

```ts
import { publish } from "@saranshkhulbe/upload-post-publisher";

const result = await publish(
  {
    kind: "photos",
    caption: "New product shots are live.",
    media: [
      "https://example.com/photo-1.jpg",
      "https://example.com/photo-2.jpg",
    ],
    platformOverrides: {
      facebook: {
        pageId: "your-facebook-page-id",
      },
    },
  },
  {
    x: true,
    instagram: true,
    facebook: false,
  },
  {
    onProgress(event) {
      console.log(`[${event.stage}] ${event.message}`);
    },
  },
);

console.log(JSON.stringify(result, null, 2));
```

If the publish fails or is partial, inspect the normalized error codes:

```ts
if (result.overallStatus !== "success") {
  console.error(result.error);
  console.error(result.platforms.instagram.error);
}
```

## Public API

The package exports:

- `publish(input, platformSelection?, options?)`
- `createPublisherService(dependencies)`
- `getPublishStatus(requestId)`
- `PublishInput`
- `PlatformSelection`
- `PublishOptions`
- `PublishResult`
- `PublishError`

## Platform Selection

All platform flags default to `false`.

```ts
{
  x: true,
  instagram: false,
  facebook: true,
}
```

That means nothing is published unless the caller explicitly opts in.

## Input Shapes

Text:

```ts
{
  kind: "text",
  caption: "Shipping an update today.",
}
```

Photos:

```ts
{
  kind: "photos",
  caption: "Gallery post",
  media: ["./photo-1.jpg", "./photo-2.jpg"],
}
```

Video:

```ts
{
  kind: "video",
  caption: "Watch the launch reel.",
  media: "./launch-reel.mp4",
}
```

Local file paths and public URLs are both supported.

## `createPublisherService()` Example

Use this if you want to inject credentials directly instead of reading from `process.env`:

```ts
import { createPublisherService } from "@saranshkhulbe/upload-post-publisher";

const publisher = createPublisherService({
  apiKey: process.env.UPLOAD_POST_API_KEY!,
  profile: process.env.UPLOAD_POST_PROFILE!,
  baseUrl: "https://api.upload-post.com/api",
});

const result = await publisher.publish(
  {
    kind: "text",
    caption: "Shipping an update today.",
    platformOverrides: {
      facebook: {
        pageId: "your-facebook-page-id",
        linkUrl: "https://example.com/article",
      },
    },
  },
  {
    x: true,
    instagram: false,
    facebook: true,
  },
);

console.log(result);
```

## Behavior Notes

- Instagram text-only publishing is not supported in this package. If Instagram is requested for a text payload, it is returned as skipped with `instagram_text_only_not_supported`.
- Facebook publishing is for connected Facebook Pages, not personal profiles.
- If your Upload Post profile has multiple connected Facebook Pages, set `platformOverrides.facebook.pageId`.
- Photo payloads accept image files only.
- Video payloads accept exactly one video.
- Mixed photo and video cross-post payloads are intentionally rejected before any API call.

## Preflight Limits

This package validates a few important limits locally before it sends the request:

- If `x: true` on a photo post, the package allows up to 4 images.
- If `instagram: true` on a photo post, the package allows up to 10 images.
- For local image files, the package checks these size limits before upload:
  - X: 5 MB per image
  - Instagram: 8 MB per image
  - Facebook: 10 MB per image
- For local Instagram videos, the package checks 300 MB maximum.
- For local Facebook `VIDEO` uploads, the package checks 10 GB maximum.

Remote URLs are still accepted, but file size validation for URLs is left to Upload Post because the package cannot reliably inspect remote assets ahead of time.

## Graceful Error Handling

Errors are normalized into a stable `PublishError` shape so your app does not need to parse Upload Post messages directly.

Common normalized error codes include:

- `authentication_error`
- `profile_not_found`
- `plan_restricted`
- `monthly_limit_exceeded`
- `daily_platform_limit_exceeded`
- `rate_limited`
- `service_unavailable`
- `account_reconnect_required`
- `account_not_linked`
- `account_permission_error`
- `account_restricted`
- `facebook_page_selection_required`
- `unsupported_content`
- `policy_violation`
- `validation_error`
- `publish_timeout`

Each normalized error can also include:

- `retryable`
- `suggestion`
- `platform`
- `usage`
- `violations`
- `availablePages`

Example:

```ts
const result = await publish(payload, {
  x: true,
  instagram: true,
  facebook: true,
});

if (result.platforms.facebook.error?.code === "facebook_page_selection_required") {
  console.log(result.platforms.facebook.error.availablePages);
}

if (result.error?.code === "daily_platform_limit_exceeded") {
  console.log(result.error.violations);
}
```

## Package Structure

The repo is organized as a library-first package:

- `src/index.ts`: public package entrypoint
- `src/config/`: environment loading
- `src/domain/`: public types and validation
- `src/lib/upload-post/`: low-level Upload Post HTTP client and endpoint wrappers
- `src/services/`: publish orchestration
- `examples/`: non-published usage examples
- `tests/`: validation and publisher tests

Only the built `dist/` output, `README.md`, and `LICENSE` are included in the published tarball.

## Local Development

Install dependencies:

```bash
bun install
```

Type-check:

```bash
bun run check
```

Run tests:

```bash
bun test
```

Build:

```bash
bun run build
```

Inspect the tarball:

```bash
bun run pack:check
```

## Publish Commands

According to npm's docs for scoped public packages, publish with `--access public`:

- [Creating and publishing scoped public packages](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/)
- [About scopes](https://docs.npmjs.com/about-scopes/)
- [bun add](https://bun.sh/docs/cli/add)

Use these commands from the package root:

```bash
npm login
npm whoami
bun run check
bun test
bun run build
bun run pack:check
npm publish --access public
```

After publishing, verify:

```bash
npm view @saranshkhulbe/upload-post-publisher version
```
