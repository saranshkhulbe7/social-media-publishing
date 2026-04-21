import type { PlatformName } from "./types";

export const MB = 1024 * 1024;
export const GB = 1024 * MB;

export const PLATFORM_DAILY_CAPS: Record<PlatformName, number> = {
  instagram: 50,
  facebook: 25,
  x: 50,
};

export const PHOTO_COUNT_LIMITS: Partial<Record<PlatformName, number>> = {
  instagram: 10,
  x: 4,
};

export const LOCAL_PHOTO_FILE_SIZE_LIMITS_BYTES: Partial<Record<PlatformName, number>> = {
  instagram: 8 * MB,
  facebook: 10 * MB,
  x: 5 * MB,
};

export const LOCAL_VIDEO_FILE_SIZE_LIMITS_BYTES = {
  instagram: 300 * MB,
  facebookVideo: 10 * GB,
} as const;

export function formatBytes(bytes: number): string {
  if (bytes >= GB) {
    return `${trimTrailingZeros((bytes / GB).toFixed(2))} GB`;
  }

  if (bytes >= MB) {
    return `${trimTrailingZeros((bytes / MB).toFixed(2))} MB`;
  }

  if (bytes >= 1024) {
    return `${trimTrailingZeros((bytes / 1024).toFixed(2))} KB`;
  }

  return `${bytes} B`;
}

function trimTrailingZeros(value: string): string {
  return value.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}
