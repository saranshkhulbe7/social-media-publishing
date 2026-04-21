import { existsSync } from "node:fs";
import { extname } from "node:path";

import type {
  MediaClassification,
  PlatformName,
  PlatformSelection,
  PublishInput,
  ValidatedPublishInput,
} from "./types.ts";

const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
]);

const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".mpeg",
  ".mpg",
  ".webm",
  ".m4v",
]);

export class ValidationError extends Error {
  override name = "ValidationError";
}

export function resolvePlatformSelection(
  inputPlatforms?: PlatformSelection,
  overridePlatforms?: PlatformSelection,
): Required<PlatformSelection> {
  return {
    x: false,
    instagram: false,
    facebook: false,
    ...inputPlatforms,
    ...overridePlatforms,
  };
}

export function selectedPlatformsFromSelection(
  selection: Required<PlatformSelection>,
): PlatformName[] {
  const platforms: PlatformName[] = [];

  if (selection.x) {
    platforms.push("x");
  }

  if (selection.instagram) {
    platforms.push("instagram");
  }

  if (selection.facebook) {
    platforms.push("facebook");
  }

  return platforms;
}

export function isUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function inferKindFromExtension(value: string): MediaClassification {
  const extension = extname(value).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) {
    return "image";
  }
  if (VIDEO_EXTENSIONS.has(extension)) {
    return "video";
  }
  return "unknown";
}

export function classifyMediaReference(reference: string): MediaClassification {
  if (isUrl(reference)) {
    const parsed = new URL(reference);
    return inferKindFromExtension(parsed.pathname);
  }

  const extensionKind = inferKindFromExtension(reference);
  if (extensionKind !== "unknown") {
    return extensionKind;
  }

  if (!existsSync(reference)) {
    throw new ValidationError(`Local media file does not exist: ${reference}`);
  }

  const fileType = Bun.file(reference).type;
  if (fileType.startsWith("image/")) {
    return "image";
  }
  if (fileType.startsWith("video/")) {
    return "video";
  }

  return "unknown";
}

function requireCaption(caption: string): string {
  const trimmed = caption.trim();
  if (!trimmed) {
    throw new ValidationError("caption must be a non-empty string.");
  }

  return trimmed;
}

function normalizeMediaList(media: string | string[]): string[] {
  return Array.isArray(media) ? media : [media];
}

export function validatePublishInput(
  input: PublishInput,
  overridePlatforms?: PlatformSelection,
): ValidatedPublishInput {
  const caption = requireCaption(input.caption);
  const selection = resolvePlatformSelection(input.platforms, overridePlatforms);
  const requestedPlatforms = selectedPlatformsFromSelection(selection);

  if (requestedPlatforms.length === 0) {
    throw new ValidationError(
      "Select at least one platform to publish to. x, instagram, and facebook all default to false.",
    );
  }

  if (input.kind === "text") {
    const publishablePlatforms: PlatformName[] = [];
    const skippedPlatforms: Partial<Record<PlatformName, string>> = {};

    if (selection.x) {
      publishablePlatforms.push("x");
    }

    if (selection.facebook) {
      publishablePlatforms.push("facebook");
    }

    if (selection.instagram) {
      skippedPlatforms.instagram = "instagram_text_only_not_supported";
    }

    if (publishablePlatforms.length === 0) {
      throw new ValidationError(
        "Text-only posts can only be published to X or Facebook. Set x: true or facebook: true, or use photos/video for Instagram.",
      );
    }

    return {
      kind: "text",
      caption,
      media: [],
      requestedPlatforms,
      publishablePlatforms,
      skippedPlatforms,
      platformOverrides: input.platformOverrides,
    };
  }

  const media = normalizeMediaList(input.media).map((entry) => entry.trim());
  if (media.length === 0 || media.some((entry) => !entry)) {
    throw new ValidationError("media must contain at least one valid reference.");
  }

  const mediaKinds = media.map(classifyMediaReference);
  if (mediaKinds.some((kind) => kind === "unknown")) {
    throw new ValidationError(
      "Unable to determine the media type for one or more items. Use local files or URLs with standard image/video extensions.",
    );
  }

  if (input.kind === "photos") {
    if (mediaKinds.some((kind) => kind !== "image")) {
      throw new ValidationError(
        "Photos payloads must contain image files only. Mixed photo/video cross-posting is intentionally blocked in v1.",
      );
    }
  }

  if (input.kind === "video") {
    if (media.length !== 1) {
      throw new ValidationError("Video payloads must contain exactly one media item.");
    }
    if (mediaKinds[0] !== "video") {
      throw new ValidationError("Video payloads must point to a video file or URL.");
    }
  }

  return {
    kind: input.kind,
    caption,
    media,
    requestedPlatforms,
    publishablePlatforms: requestedPlatforms,
    skippedPlatforms: {},
    platformOverrides: input.platformOverrides,
  };
}
