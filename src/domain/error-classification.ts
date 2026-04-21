import type {
  PlatformName,
  PublishError,
  UploadPostUsage,
  UploadPostViolation,
} from "./types";

interface ClassifyUploadPostFailureOptions {
  details?: unknown;
  fallbackCode?: PublishError["code"];
  httpStatus?: number;
  message?: string;
  platform?: PlatformName;
}

const RECONNECT_PATTERNS = [
  "session has expired",
  "token expired and refresh failed",
  "changed their password",
  "error validating access token",
  "could not be refreshed",
  "user has not authorized application",
];

const RESTRICTED_PATTERNS = [
  "temporarily locked",
  "restricted or inactive",
  "suspected as spam",
  "account is restricted",
  "authenticated user is suspended",
  "used for authentication is suspended",
  "not a confirmed user",
];

const UNSUPPORTED_CONTENT_PATTERNS = [
  "unsupported image size",
  "invalid image aspect ratio",
  "video longer than",
  "media could not be fetched",
  "downloaded file is too small",
  "collaborator usernames are invalid",
  "one or more tags are invalid",
  "unsupported media",
  "invalid media",
];

const POLICY_PATTERNS = [
  "duplicate",
  "similar content",
  "mention limits",
  "spam risk",
];

export function classifyUploadPostFailure(
  options: ClassifyUploadPostFailureOptions,
): PublishError {
  const details = asRecord(options.details);
  const message =
    options.message?.trim() ||
    readString(details, "message") ||
    readString(details, "error") ||
    defaultMessageForStatus(options.httpStatus);
  const lowerMessage = message.toLowerCase();
  const violations = extractViolations(details);
  const usage = extractUsage(details);
  const availablePages = extractAvailablePages(details);

  if (options.httpStatus === 401) {
    return createError({
      code: "authentication_error",
      message,
      details,
      platform: options.platform,
      retryable: false,
      suggestion: "Check the Upload Post API key and authentication header, then retry.",
      usage,
      violations,
      availablePages,
    });
  }

  if (
    options.httpStatus === 403 ||
    lowerMessage.includes("plan restriction") ||
    lowerMessage.includes("upgrade your plan") ||
    lowerMessage.includes("forbidden")
  ) {
    return createError({
      code: "plan_restricted",
      message,
      details,
      platform: options.platform,
      retryable: false,
      suggestion: "Check your Upload Post plan limits and profile permissions, then retry.",
      usage,
      violations,
      availablePages,
    });
  }

  if (options.httpStatus === 404 || lowerMessage.includes("user not found")) {
    return createError({
      code: "profile_not_found",
      message,
      details,
      platform: options.platform,
      retryable: false,
      suggestion: "Verify the Upload Post profile username and make sure it is associated with your API key.",
      usage,
      violations,
      availablePages,
    });
  }

  if (
    violations.some((violation) => violation.type === "hard_cap") ||
    lowerMessage.includes("daily cap reached") ||
    lowerMessage.includes("daily limit")
  ) {
    return createError({
      code: "daily_platform_limit_exceeded",
      message,
      details,
      platform: options.platform ?? firstViolationPlatform(violations),
      retryable: true,
      suggestion:
        "Wait for the 24-hour platform window to roll over before retrying this account.",
      usage,
      violations,
      availablePages,
    });
  }

  if (
    lowerMessage.includes("monthly limit") ||
    lowerMessage.includes("would exceed your monthly limit")
  ) {
    return createError({
      code: "monthly_limit_exceeded",
      message,
      details,
      platform: options.platform,
      retryable: false,
      suggestion: "Wait for your monthly Upload Post quota reset or upgrade your Upload Post plan.",
      usage,
      violations,
      availablePages,
    });
  }

  if (
    availablePages.length > 0 ||
    lowerMessage.includes("multiple facebook pages found") ||
    lowerMessage.includes("facebook page id is required") ||
    lowerMessage.includes("no facebook pages found for your account")
  ) {
    return createError({
      code: "facebook_page_selection_required",
      message,
      details,
      platform: options.platform ?? "facebook",
      retryable: false,
      suggestion:
        "Connect a Facebook Page in Upload Post and set platformOverrides.facebook.pageId when multiple Pages are linked.",
      usage,
      violations,
      availablePages,
    });
  }

  if (
    lowerMessage.includes("not permitted to access that resource") ||
    lowerMessage.includes("page access token") ||
    lowerMessage.includes("grant") && lowerMessage.includes("permission")
  ) {
    return createError({
      code: "account_permission_error",
      message,
      details,
      platform: options.platform,
      retryable: false,
      suggestion:
        "Make sure the connected account has the required permissions and reconnect it with all requested scopes.",
      usage,
      violations,
      availablePages,
    });
  }

  if (matchesAny(lowerMessage, RECONNECT_PATTERNS)) {
    return createError({
      code: "account_reconnect_required",
      message,
      details,
      platform: options.platform,
      retryable: false,
      suggestion:
        "Reconnect the affected social account in Upload Post > Manage Users, then retry the publish.",
      usage,
      violations,
      availablePages,
    });
  }

  if (matchesAny(lowerMessage, RESTRICTED_PATTERNS)) {
    return createError({
      code: "account_restricted",
      message,
      details,
      platform: options.platform,
      retryable: false,
      suggestion:
        "Resolve the restriction directly on the social platform, then reconnect the account in Upload Post if needed.",
      usage,
      violations,
      availablePages,
    });
  }

  if (
    lowerMessage.includes("not found or not configured") ||
    lowerMessage.includes("username not associated with any profile") ||
    lowerMessage.includes("account not found")
  ) {
    return createError({
      code: "account_not_linked",
      message,
      details,
      platform: options.platform,
      retryable: false,
      suggestion:
        "Connect the missing social account to the Upload Post profile before publishing again.",
      usage,
      violations,
      availablePages,
    });
  }

  if (matchesAny(lowerMessage, UNSUPPORTED_CONTENT_PATTERNS)) {
    return createError({
      code: "unsupported_content",
      message,
      details,
      platform: options.platform,
      retryable: false,
      suggestion:
        "Adjust the media format, file size, aspect ratio, or caption so it matches the target platform requirements.",
      usage,
      violations,
      availablePages,
    });
  }

  if (matchesAny(lowerMessage, POLICY_PATTERNS)) {
    return createError({
      code: "policy_violation",
      message,
      details,
      platform: options.platform,
      retryable: false,
      suggestion:
        "Change the content enough to avoid duplicate or spam-like behavior before retrying.",
      usage,
      violations,
      availablePages,
    });
  }

  if (
    options.httpStatus === 503 ||
    lowerMessage.includes("service unavailable") ||
    lowerMessage.includes("temporary issue") ||
    lowerMessage.includes("unexpected error") ||
    lowerMessage === "fatal"
  ) {
    return createError({
      code: "service_unavailable",
      message,
      details,
      platform: options.platform,
      retryable: true,
      suggestion: "Retry the publish in a few minutes.",
      usage,
      violations,
      availablePages,
    });
  }

  if (options.httpStatus === 429 || lowerMessage.includes("rate limit")) {
    return createError({
      code: "rate_limited",
      message,
      details,
      platform: options.platform,
      retryable: true,
      suggestion: "Back off and retry later.",
      usage,
      violations,
      availablePages,
    });
  }

  return createError({
    code: options.fallbackCode ?? "api_error",
    message,
    details,
    platform: options.platform,
    retryable: options.httpStatus !== undefined && options.httpStatus >= 500,
    suggestion: options.httpStatus !== undefined && options.httpStatus >= 500
      ? "Retry later. If the problem persists, contact Upload Post support."
      : undefined,
    usage,
    violations,
    availablePages,
  });
}

function createError(options: PublishError): PublishError {
  return options;
}

function matchesAny(message: string, patterns: string[]): boolean {
  return patterns.some((pattern) => message.includes(pattern));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function readString(
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

function extractViolations(
  details: Record<string, unknown> | undefined,
): UploadPostViolation[] {
  if (!Array.isArray(details?.violations)) {
    return [];
  }

  return details.violations.filter(
    (entry): entry is UploadPostViolation =>
      Boolean(entry) && typeof entry === "object",
  );
}

function extractUsage(
  details: Record<string, unknown> | undefined,
): UploadPostUsage | undefined {
  if (!details?.usage || typeof details.usage !== "object") {
    return undefined;
  }

  return details.usage as UploadPostUsage;
}

function extractAvailablePages(
  details: Record<string, unknown> | undefined,
): Array<Record<string, unknown>> {
  if (!Array.isArray(details?.available_pages)) {
    return [];
  }

  return details.available_pages.filter(
    (entry): entry is Record<string, unknown> =>
      Boolean(entry) && typeof entry === "object",
  );
}

function firstViolationPlatform(
  violations: UploadPostViolation[],
): PlatformName | undefined {
  const platform = violations[0]?.platform;
  if (platform === "x" || platform === "instagram" || platform === "facebook") {
    return platform;
  }

  return undefined;
}

function defaultMessageForStatus(status?: number): string {
  if (status === 503) {
    return "Upload Post is temporarily unavailable.";
  }

  if (status === 429) {
    return "Upload Post rate limit reached.";
  }

  return "Upload Post request failed.";
}
