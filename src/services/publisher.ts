import { loadEnv } from "../config/env.ts";
import type {
  PlatformName,
  PlatformSelection,
  PlatformResult,
  PublishError,
  PublishInput,
  PublishOptions,
  PublishProgressEvent,
  PublishResult,
  PublishResultStatus,
  UploadPostAsyncResponse,
  UploadPostPlatformResponse,
  UploadPostStatusEntry,
  UploadPostStatusResponse,
  UploadPostSyncResponse,
  ValidatedPublishInput,
} from "../domain/types.ts";
import {
  resolvePlatformSelection,
  selectedPlatformsFromSelection,
  validatePublishInput,
  ValidationError,
} from "../domain/validation.ts";
import { UploadPostApiError, UploadPostClient, UploadPostPollingError } from "../lib/upload-post/client.ts";
import {
  getStatus as getUploadStatus,
  uploadPhotos,
  uploadText,
  uploadVideo,
} from "../lib/upload-post/endpoints.ts";

export interface PublisherDependencies {
  client: UploadPostClient;
  profile: string;
  pollIntervalMs: number;
  pollTimeoutMs: number;
}

type ProgressReporter = ((event: PublishProgressEvent) => void) | undefined;

function createPlatformResult(status: PlatformResult["status"]): PlatformResult {
  return { status };
}

function createBaseResult(requestedPlatforms: PlatformName[]): PublishResult {
  return {
    overallStatus: requestedPlatforms.length === 0 ? "pending" : "failed",
    requestedPlatforms,
    platforms: {
      x: requestedPlatforms.includes("x")
        ? createPlatformResult("pending")
        : {
            status: "skipped",
            reason: "not_requested",
          },
      instagram: requestedPlatforms.includes("instagram")
        ? createPlatformResult("pending")
        : {
            status: "skipped",
            reason: "not_requested",
          },
      facebook: requestedPlatforms.includes("facebook")
        ? createPlatformResult("pending")
        : {
            status: "skipped",
            reason: "not_requested",
          },
    },
  };
}

function applySkippedPlatforms(
  result: PublishResult,
  skippedPlatforms: Partial<Record<PlatformName, string>>,
): void {
  for (const [platform, reason] of Object.entries(skippedPlatforms)) {
    if (platform === "x" || platform === "instagram" || platform === "facebook") {
      result.platforms[platform] = {
        status: "skipped",
        reason,
      };
    }
  }
}

function emitProgress(
  onProgress: ProgressReporter,
  stage: string,
  message: string,
  details?: unknown,
): void {
  onProgress?.({
    stage,
    message,
    details,
  });
}

function toPublishError(error: unknown): PublishError {
  if (error instanceof ValidationError) {
    return {
      code: "validation_error",
      message: error.message,
    };
  }

  if (error instanceof UploadPostPollingError) {
    return {
      code: "publish_timeout",
      message: error.message,
      details: error.lastResponse,
    };
  }

  if (error instanceof UploadPostApiError) {
    const body = error.body as Record<string, unknown> | undefined;
    const message =
      (body &&
        typeof body.message === "string" &&
        body.message) ||
      error.message;

    if (error.status === 401) {
      return {
        code: "authentication_error",
        message,
        details: body,
      };
    }

    if (error.status === 404) {
      return {
        code: "profile_not_found",
        message,
        details: body,
      };
    }

    if (error.status === 429) {
      const code =
        message.toLowerCase().includes("monthly limit")
          ? "monthly_limit_exceeded"
          : "rate_limited";
      return {
        code,
        message,
        details: body,
      };
    }

    return {
      code: "api_error",
      message,
      details: body ?? { status: error.status, url: error.url },
    };
  }

  if (error instanceof Error) {
    return {
      code: "network_error",
      message: error.message,
    };
  }

  return {
    code: "unexpected_response",
    message: "An unexpected error occurred.",
    details: error,
  };
}

function inferOverallStatus(result: PublishResult): PublishResultStatus {
  const relevantPlatforms = result.requestedPlatforms.map(
    (platform) => result.platforms[platform],
  );

  if (relevantPlatforms.length === 0) {
    return "pending";
  }

  if (relevantPlatforms.some((platform) => platform.status === "pending")) {
    return "pending";
  }

  const publishedCount = relevantPlatforms.filter(
    (platform) => platform.status === "published",
  ).length;
  const failedCount = relevantPlatforms.filter(
    (platform) => platform.status === "failed",
  ).length;

  if (publishedCount === relevantPlatforms.length) {
    return "success";
  }

  if (failedCount === relevantPlatforms.length) {
    return "failed";
  }

  return "partial_failure";
}

function normalizePlatformResponse(
  response: UploadPostPlatformResponse | UploadPostStatusEntry | undefined,
  topLevelStatus?: UploadPostStatusResponse["status"],
): PlatformResult {
  if (!response) {
    return {
      status: topLevelStatus === "completed" ? "unknown" : "pending",
    };
  }

  if (response.success === true) {
    return {
      status: topLevelStatus === "completed" || topLevelStatus === undefined
        ? "published"
        : "pending",
      publishedUrl: typeof response.url === "string" ? response.url : undefined,
      raw: response,
    };
  }

  if (response.success === false) {
    return {
      status: "failed",
      error: {
        code: "platform_publish_failed",
        message:
          (typeof response.error === "string" && response.error) ||
          (typeof response.message === "string" && response.message) ||
          "Platform publish failed.",
        details: response,
      },
      raw: response,
    };
  }

  return {
    status: topLevelStatus === "completed" ? "unknown" : "pending",
    raw: response,
  };
}

function normalizeSyncResponse(
  response: UploadPostSyncResponse,
  validatedInput: ValidatedPublishInput,
  requestId: string,
): PublishResult {
  const result = createBaseResult(validatedInput.requestedPlatforms);
  result.requestId = requestId;
  result.raw = response;
  applySkippedPlatforms(result, validatedInput.skippedPlatforms);

  if (validatedInput.publishablePlatforms.includes("x")) {
    result.platforms.x = normalizePlatformResponse(response.results?.x);
  }

  if (validatedInput.publishablePlatforms.includes("instagram")) {
    result.platforms.instagram = normalizePlatformResponse(response.results?.instagram);
  }

  if (validatedInput.publishablePlatforms.includes("facebook")) {
    result.platforms.facebook = normalizePlatformResponse(response.results?.facebook);
  }

  result.overallStatus = inferOverallStatus(result);
  return result;
}

function normalizeStatusResponse(
  response: UploadPostStatusResponse,
  requestedPlatforms: PlatformName[],
  publishablePlatforms: PlatformName[] = requestedPlatforms,
  skippedPlatforms: Partial<Record<PlatformName, string>> = {},
): PublishResult {
  const result = createBaseResult(requestedPlatforms);
  result.requestId = response.request_id;
  result.jobId = response.job_id;
  result.raw = response;
  applySkippedPlatforms(result, skippedPlatforms);

  const statusEntries = new Map<PlatformName, UploadPostStatusEntry>();
  for (const entry of response.results ?? []) {
    if (
      entry.platform === "x" ||
      entry.platform === "instagram" ||
      entry.platform === "facebook"
    ) {
      statusEntries.set(entry.platform, entry);
    }
  }

  if (publishablePlatforms.includes("x")) {
    result.platforms.x = normalizePlatformResponse(
      statusEntries.get("x"),
      response.status,
    );
  }

  if (publishablePlatforms.includes("instagram")) {
    result.platforms.instagram = normalizePlatformResponse(
      statusEntries.get("instagram"),
      response.status,
    );
  }

  if (publishablePlatforms.includes("facebook")) {
    result.platforms.facebook = normalizePlatformResponse(
      statusEntries.get("facebook"),
      response.status,
    );
  }

  result.overallStatus =
    response.status === "completed" ? inferOverallStatus(result) : "pending";
  return result;
}

function isAsyncResponse(response: unknown): response is UploadPostAsyncResponse {
  return Boolean(
    response &&
      typeof response === "object" &&
      "request_id" in response &&
      typeof response.request_id === "string",
  );
}

function isSyncResponse(response: unknown): response is UploadPostSyncResponse {
  return Boolean(
    response &&
      typeof response === "object" &&
      "results" in response &&
      response.results &&
      typeof response.results === "object",
  );
}

async function executePublish(
  validatedInput: ValidatedPublishInput,
  dependencies: PublisherDependencies,
  onProgress?: ProgressReporter,
): Promise<PublishResult> {
  const requestId = dependencies.client.generateRequestId();
  const xOverrides = validatedInput.platformOverrides?.x;
  const instagramOverrides = validatedInput.platformOverrides?.instagram;
  const facebookOverrides = validatedInput.platformOverrides?.facebook;

  emitProgress(
    onProgress,
    "publish.prepared",
    `Prepared publish request ${requestId} for ${validatedInput.publishablePlatforms.join(", ")}.`,
    {
      requestId,
      kind: validatedInput.kind,
      requestedPlatforms: validatedInput.requestedPlatforms,
      publishablePlatforms: validatedInput.publishablePlatforms,
    },
  );

  let response: UploadPostSyncResponse | UploadPostAsyncResponse;
  if (validatedInput.kind === "text") {
    emitProgress(onProgress, "publish.submitting", "Submitting text post to Upload Post.");
    response = await uploadText(dependencies.client, {
      user: dependencies.profile,
      caption: validatedInput.caption,
      requestId,
      platforms: validatedInput.publishablePlatforms,
      xTitle: xOverrides?.title,
      xLongTextAsPost: xOverrides?.longTextAsPost,
      facebookTitle: facebookOverrides?.title,
      facebookPageId: facebookOverrides?.pageId,
      facebookLinkUrl: facebookOverrides?.linkUrl,
    }, onProgress);
  } else if (validatedInput.kind === "photos") {
    emitProgress(onProgress, "publish.submitting", "Submitting photo post to Upload Post.");
    response = await uploadPhotos(dependencies.client, {
      user: dependencies.profile,
      caption: validatedInput.caption,
      media: validatedInput.media,
      requestId,
      platforms: validatedInput.publishablePlatforms,
      xTitle: xOverrides?.title,
      instagramTitle: instagramOverrides?.title,
      xLongTextAsPost: xOverrides?.longTextAsPost,
      facebookTitle: facebookOverrides?.title,
      facebookDescription: facebookOverrides?.description,
      facebookPageId: facebookOverrides?.pageId,
      facebookMediaType:
        facebookOverrides?.mediaType === "STORIES" ? "STORIES" : "POSTS",
    }, onProgress);
  } else {
    emitProgress(onProgress, "publish.submitting", "Submitting video post to Upload Post.");
    response = await uploadVideo(dependencies.client, {
      user: dependencies.profile,
      caption: validatedInput.caption,
      media: validatedInput.media[0]!,
      requestId,
      platforms: validatedInput.publishablePlatforms,
      xTitle: xOverrides?.title,
      instagramTitle: instagramOverrides?.title,
      xLongTextAsPost: xOverrides?.longTextAsPost,
      instagramMediaType:
        instagramOverrides?.mediaType === "STORIES" ? "STORIES" : "REELS",
      shareToFeed:
        instagramOverrides?.shareToFeed ??
        instagramOverrides?.mediaType !== "STORIES",
      facebookTitle: facebookOverrides?.title,
      facebookDescription: facebookOverrides?.description,
      facebookPageId: facebookOverrides?.pageId,
      facebookMediaType:
        facebookOverrides?.mediaType === "STORIES" ||
        facebookOverrides?.mediaType === "VIDEO"
          ? facebookOverrides.mediaType
          : "REELS",
      facebookVideoState: facebookOverrides?.videoState,
      facebookThumbnailUrl: facebookOverrides?.thumbnailUrl,
    }, onProgress);
  }

  if (isSyncResponse(response)) {
    emitProgress(
      onProgress,
      "publish.sync_completed",
      `Upload Post completed synchronously for request ${requestId}.`,
      response,
    );
    return normalizeSyncResponse(response, validatedInput, requestId);
  }

  if (isAsyncResponse(response)) {
    emitProgress(
      onProgress,
      "publish.accepted",
      `Upload Post accepted request ${response.request_id ?? requestId} and is processing it asynchronously.`,
      response,
    );
    const finalStatus = await dependencies.client.pollStatus(response.request_id!, {
      intervalMs: dependencies.pollIntervalMs,
      timeoutMs: dependencies.pollTimeoutMs,
    }, onProgress);

    const result = normalizeStatusResponse(
      finalStatus,
      validatedInput.requestedPlatforms,
      validatedInput.publishablePlatforms,
      validatedInput.skippedPlatforms,
    );
    result.requestId = response.request_id;
    result.raw = {
      initial: response,
      final: finalStatus,
    };
    emitProgress(
      onProgress,
      "publish.completed",
      `Upload Post finished processing request ${response.request_id}.`,
      result,
    );
    return result;
  }

  throw new Error("Upload Post returned an unexpected publish response.");
}

function buildErrorResult(
  requestedPlatforms: PlatformName[],
  error: PublishError,
  skippedPlatforms: Partial<Record<PlatformName, string>> = {},
): PublishResult {
  const result = createBaseResult(requestedPlatforms);
  result.error = error;

  for (const platform of requestedPlatforms) {
    if (platform in skippedPlatforms) {
      continue;
    }

    result.platforms[platform] = {
      status: "failed",
      error,
    };
  }

  applySkippedPlatforms(result, skippedPlatforms);
  result.overallStatus = "failed";
  return result;
}

export function createPublisherService(dependencies: PublisherDependencies) {
  return {
    async publish(
      input: PublishInput,
      platformSelection: PlatformSelection = {},
      options: PublishOptions = {},
    ): Promise<PublishResult> {
      emitProgress(options.onProgress, "validation.started", "Validating publish input.");
      try {
        const validatedInput = validatePublishInput(input, platformSelection);
        emitProgress(
          options.onProgress,
          "validation.completed",
          `Validation passed for ${validatedInput.kind} publish request.`,
          {
            requestedPlatforms: validatedInput.requestedPlatforms,
            publishablePlatforms: validatedInput.publishablePlatforms,
            skippedPlatforms: validatedInput.skippedPlatforms,
          },
        );
        return await executePublish(validatedInput, dependencies, options.onProgress);
      } catch (error) {
        const normalizedError = toPublishError(error);
        emitProgress(
          options.onProgress,
          "publish.failed",
          `Publish failed: ${normalizedError.message}`,
          normalizedError,
        );
        try {
          const validatedInput = validatePublishInput(input, platformSelection);
          return buildErrorResult(
            validatedInput.requestedPlatforms,
            normalizedError,
            validatedInput.skippedPlatforms,
          );
        } catch {
          const requestedPlatforms = selectedPlatformsFromSelection(
            resolvePlatformSelection(input.platforms, platformSelection),
          );
          return buildErrorResult(requestedPlatforms, normalizedError);
        }
      }
    },

    async getPublishStatus(requestId: string): Promise<PublishResult> {
      try {
        const response = await getUploadStatus(dependencies.client, requestId);
        const inferredPlatforms = new Set<PlatformName>();
        for (const entry of response.results ?? []) {
          if (
            entry.platform === "x" ||
            entry.platform === "instagram" ||
            entry.platform === "facebook"
          ) {
            inferredPlatforms.add(entry.platform);
          }
        }

        return normalizeStatusResponse(response, [...inferredPlatforms]);
      } catch (error) {
        const normalizedError = toPublishError(error);
        const result = createBaseResult([]);
        result.error = normalizedError;
        result.overallStatus = "failed";
        return result;
      }
    },
  };
}

function createDefaultPublisherService() {
  const env = loadEnv();
  const client = new UploadPostClient({
    apiKey: env.apiKey,
    baseUrl: env.baseUrl,
  });

  return createPublisherService({
    client,
    profile: env.profile,
    pollIntervalMs: env.pollIntervalMs,
    pollTimeoutMs: env.pollTimeoutMs,
  });
}

export async function publish(
  input: PublishInput,
  platformSelection: PlatformSelection = {},
  options: PublishOptions = {},
): Promise<PublishResult> {
  return createDefaultPublisherService().publish(input, platformSelection, options);
}

export async function getPublishStatus(requestId: string): Promise<PublishResult> {
  return createDefaultPublisherService().getPublishStatus(requestId);
}
