import { publish } from "../index.ts";
import type {
  PublishProgressEvent,
  PlatformSelection,
  PublishInput,
  PublishResult,
} from "../domain/types.ts";

// Edit this payload directly before running `bun run publish:script`.
// This default uses photos because that's the simplest way to cross-post to X and Instagram.
const payload: PublishInput = {
  kind: "photos",
  caption: "New product shots are live.",
  media: [
    "https://test-storage.xpoll.io/avatars/alexander.jpg",
    "https://test-storage.xpoll.io/avatars/anika-verma.jpg",
  ],
  platformOverrides: {
    x: {
      title: "New product shots are live on X.",
    },
    instagram: {
      title: "New product shots are live on Instagram.",
    },
  },
};

// Both flags default to false, so set each one explicitly when you want it.
const platforms: PlatformSelection = {
  x: true,
  instagram: true,
  facebook: false,
};

// To post a video to both X and Instagram, switch to:
// const payload: PublishInput = {
//   kind: "video",
//   caption: "Watch the launch reel.",
//   media: "https://example.com/launch-reel.mp4",
// };

// To post text only, switch to:
// const payload: PublishInput = {
//   kind: "text",
//   caption: "Shipping our latest update today.",
// };
// For text-only posts, set `platforms.x = true`.
// For Facebook text or media posts, set `platforms.facebook = true`.
// If you have multiple connected Facebook Pages, set `platformOverrides.facebook.pageId`.
// Instagram does not support text-only publishing in this project.

function shouldExitNonZero(result: PublishResult): boolean {
  return result.overallStatus !== "success";
}

function formatElapsed(startedAt: number): string {
  const elapsedMs = Date.now() - startedAt;
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  let lastProgressMessage = "Starting publish...";

  const onProgress = (event: PublishProgressEvent): void => {
    lastProgressMessage = event.message;
    console.log(`[${formatElapsed(startedAt)}] ${event.message}`);
  };

  const heartbeat = setInterval(() => {
    console.log(
      `[${formatElapsed(startedAt)}] Still working... ${lastProgressMessage}`,
    );
  }, 2_000);

  try {
    const result = await publish(payload, platforms, { onProgress });
    console.log(JSON.stringify(result, null, 2));

    if (shouldExitNonZero(result)) {
      process.exitCode = 1;
    }
  } finally {
    clearInterval(heartbeat);
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}
