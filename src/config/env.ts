const DEFAULT_BASE_URL = "https://api.upload-post.com/api";
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_POLL_TIMEOUT_MS = 60_000;

export interface EnvConfig {
  apiKey: string;
  profile: string;
  baseUrl: string;
  pollIntervalMs: number;
  pollTimeoutMs: number;
}

function getEnvSource(): Record<string, string | undefined> {
  if (typeof Bun !== "undefined") {
    return Bun.env;
  }

  return process.env;
}

function readRequiredString(
  source: Record<string, string | undefined>,
  key: string,
): string {
  const value = source[key]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

function readOptionalPositiveInt(
  source: Record<string, string | undefined>,
  key: string,
  fallback: number,
): number {
  const rawValue = source[key]?.trim();
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `Environment variable ${key} must be a positive integer. Received: ${rawValue}`,
    );
  }

  return parsed;
}

export function loadEnv(
  source: Record<string, string | undefined> = getEnvSource(),
): EnvConfig {
  return {
    apiKey: readRequiredString(source, "UPLOAD_POST_API_KEY"),
    profile: readRequiredString(source, "UPLOAD_POST_PROFILE"),
    baseUrl: source.UPLOAD_POST_BASE_URL?.trim() || DEFAULT_BASE_URL,
    pollIntervalMs: readOptionalPositiveInt(
      source,
      "UPLOAD_POST_POLL_INTERVAL_MS",
      DEFAULT_POLL_INTERVAL_MS,
    ),
    pollTimeoutMs: readOptionalPositiveInt(
      source,
      "UPLOAD_POST_POLL_TIMEOUT_MS",
      DEFAULT_POLL_TIMEOUT_MS,
    ),
  };
}
