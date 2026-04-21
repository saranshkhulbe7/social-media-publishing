# social-media-posting

A Bun-based TypeScript publisher for Upload Post that targets X, Instagram, and Facebook.

## What It Does

- Publishes only to the platforms you explicitly enable per call
- Supports text-only posts on X
- Supports text, photo, and video posts on Facebook
- Supports photo and video posts on X and Instagram
- Uses Upload Post's REST API directly with Bun `fetch`, `FormData`, and `Bun.file`
- Polls async Upload Post jobs until they complete

## Setup

Install dependencies:

```bash
bun install
```

Create your environment file:

```bash
cp .env.example .env
```

Required environment variables:

- `UPLOAD_POST_API_KEY`
- `UPLOAD_POST_PROFILE`

Optional environment variables:

- `UPLOAD_POST_BASE_URL`
- `UPLOAD_POST_POLL_INTERVAL_MS`
- `UPLOAD_POST_POLL_TIMEOUT_MS`

## Recommended Workflow

The main workflow is now script-first, not CLI-first.

1. Open [src/scripts/publish.ts](/Users/saranshkhulbe/Documents/Projects/test-location/social-media-posting/src/scripts/publish.ts)
2. Edit the `payload` object and the `platforms` object at the top of the file
3. Run:

```bash
bun run publish:script
```

The default payload uses photos, and the script explicitly enables both X and Instagram.

Notes:

- Public URLs and local file paths are both supported in the script
- `publish(payload, { instagram: true, x: false, facebook: false })` publishes to Instagram only
- `publish(payload, { instagram: false, x: true, facebook: false })` publishes to X only
- `publish(payload, { instagram: false, x: false, facebook: true })` publishes to Facebook only
- All platform flags default to `false`, so you must opt into each platform you want
- Switching `kind` to `"text"` works for X and Facebook, but Instagram text-only posting is not supported in this project
- Facebook publishes to Pages, not personal profiles. If your Upload Post profile has multiple connected Pages, set `platformOverrides.facebook.pageId`
- The script prints progress logs immediately and a heartbeat every 2 seconds while it is still running

## Reference Examples

These JSON files are still available as reference payloads, but they are no longer the primary way to publish:

- [src/examples/text.json](/Users/saranshkhulbe/Documents/Projects/test-location/social-media-posting/src/examples/text.json)
- [src/examples/photos.json](/Users/saranshkhulbe/Documents/Projects/test-location/social-media-posting/src/examples/photos.json)
- [src/examples/video.json](/Users/saranshkhulbe/Documents/Projects/test-location/social-media-posting/src/examples/video.json)

## Optional CLI Workflow

If you still want to use the CLI path, it remains available:

```bash
bun run index.ts publish ./src/examples/photos.json
bun run publish -- ./src/examples/photos.json
bun run status -- <request-id>
```

## Development

Type-check:

```bash
bun run check
```

Run tests:

```bash
bun test
```
