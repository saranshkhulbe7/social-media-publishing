import { loadEnv } from "../config/env";
import type {
  PlatformName,
  PublishLogger,
  PlatformResult,
  PlatformSelection,
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
} from "../domain/types";
import { classifyUploadPostFailure } from "../domain/error-classification";
import {
  resolvePlatformSelection,
  selectedPlatformsFromSelection,
  validatePublishInput,
  ValidationError,
} from "../domain/validation";
import {
  UploadPostApiError,
  UploadPostClient,
  UploadPostPollingError,
} from "../lib/upload-post/client";
import {
  getStatus as getUploadStatus,
  uploadPhotos,
  uploadText,
  uploadVideo,
} from "../lib/upload-post/endpoints";

type ProgressReporter = ((event: PublishProgressEvent) => void) | undefined;

export interface PublisherDependencies {
  apiKey: string;
  profile: string;
  baseUrl?: string;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

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
        : { status: "skipped", reason: "not_requested" },
      instagram: requestedPlatforms.includes("instagram")
        ? createPlatformResult("pending")
        : { status: "skipped", reason: "not_requested" },
      facebook: requestedPlatforms.includes("facebook")
        ? createPlatformResult("pending")
        : { status: "skipped", reason: "not_requested" },
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
  requestId?: string,
): void {
  onProgress?.({
    stage,
    message,
    details,
    requestId,
  });
}

function createSummaryLines(result: PublishResult): string[] {
  return [
    `Publish summary: ${result.overallStatus}`,
    `x: ${formatPlatformSummary(result.platforms.x)}`,
    `instagram: ${formatPlatformSummary(result.platforms.instagram)}`,
    `facebook: ${formatPlatformSummary(result.platforms.facebook)}`,
  ];
}

function formatPlatformSummary(result: PlatformResult): string {
  if (result.status === "published") {
    return "published";
  }

  if (result.status === "failed") {
    const code = result.error?.code;
    return code ? `failed (${code})` : "failed";
  }

  if (result.status === "skipped") {
    if (result.reason === "not_requested") {
      return "skipped";
    }

    return result.reason ? `skipped (${result.reason})` : "skipped";
  }

  return result.status;
}

function printPublishSummary(
  logger: PublishLogger,
  result: PublishResult,
): void {
  for (const line of createSummaryLines(result)) {
    logger.log(line);
  }
}

function createInternalProgressReporter(
  showLogs: boolean,
  logger: PublishLogger,
): ProgressReporter {
  if (!showLogs) {
    return undefined;
  }

  return (event) => {
    logger.log(`[${event.stage}] ${event.message}`);
  };
}

function mergeProgressReporters(
  first: ProgressReporter,
  second: ProgressReporter,
): ProgressReporter {
  if (!first) {
    return second;
  }

  if (!second) {
    return first;
  }

  return (event) => {
    first(event);
    second(event);
  };
}

function toPublishError(error: unknown): PublishError {
  if (error instanceof ValidationError) {
    return {
      code: "validation_error",
      message: error.message,
      retryable: false,
      suggestion: "Adjust the payload or platform selection and try again.",
    };
  }

  if (error instanceof UploadPostPollingError) {
    return {
      code: "publish_timeout",
      message: error.message,
      retryable: true,
      suggestion:
        "Keep polling with getPublishStatus(requestId) or retry later if Upload Post is still processing the job.",
      details: error.lastResponse,
    };
  }

  if (error instanceof UploadPostApiError) {
    const body = error.body as Record<string, unknown> | undefined;
    return classifyUploadPostFailure({
      details: body ?? { status: error.status, url: error.url },
      fallbackCode: "api_error",
      httpStatus: error.status,
      message:
        (body && typeof body.message === "string" && body.message) ||
        (body && typeof body.error === "string" && body.error) ||
        error.message,
    });
  }

  if (error instanceof Error) {
    return {
      code: "network_error",
      message: error.message,
      retryable: true,
      suggestion: "Check network connectivity and retry the request.",
    };
  }

  return {
    code: "unexpected_response",
    message: "An unexpected error occurred.",
    retryable: false,
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
  platform: PlatformName,
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

  if (
    response.success === false ||
    typeof response.error === "string" ||
    (topLevelStatus === "completed" && typeof response.message === "string")
  ) {
    return {
      status: "failed",
      error: classifyUploadPostFailure({
        details: response,
        fallbackCode: "platform_publish_failed",
        message:
          (typeof response.error === "string" && response.error) ||
          (typeof response.message === "string" && response.message) ||
          "Platform publish failed.",
        platform,
      }),
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

  for (const platform of validatedInput.publishablePlatforms) {
    result.platforms[platform] = normalizePlatformResponse(
      response.results?.[platform],
      platform,
    );
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

  for (const platform of publishablePlatforms) {
    result.platforms[platform] = normalizePlatformResponse(
      statusEntries.get(platform),
      platform,
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

function createClient(dependencies: PublisherDependencies): UploadPostClient {
  return new UploadPostClient({
    apiKey: dependencies.apiKey,
    baseUrl: dependencies.baseUrl ?? "https://api.upload-post.com/api",
    fetchImpl: dependencies.fetchImpl,
  });
}

async function executePublish(
  validatedInput: ValidatedPublishInput,
  dependencies: PublisherDependencies,
  onProgress?: ProgressReporter,
): Promise<PublishResult> {
  const client = createClient(dependencies);
  const requestId = client.generateRequestId();
  const xOverrides = validatedInput.platformOverrides?.x;
  const instagramOverrides = validatedInput.platformOverrides?.instagram;
  const facebookOverrides = validatedInput.platformOverrides?.facebook;

  emitProgress(
    onProgress,
    "publish.prepared",
    `Prepared publish request ${requestId} for ${validatedInput.publishablePlatforms.join(", ")}.`,
    {
      kind: validatedInput.kind,
      requestedPlatforms: validatedInput.requestedPlatforms,
      publishablePlatforms: validatedInput.publishablePlatforms,
    },
    requestId,
  );

  let response: UploadPostSyncResponse | UploadPostAsyncResponse;
  if (validatedInput.kind === "text") {
    emitProgress(
      onProgress,
      "publish.submitting",
      "Submitting text post to Upload Post.",
      undefined,
      requestId,
    );
    response = await uploadText(
      client,
      {
        user: dependencies.profile,
        caption: validatedInput.caption,
        requestId,
        platforms: validatedInput.publishablePlatforms,
        xTitle: xOverrides?.title,
        xLongTextAsPost: xOverrides?.longTextAsPost,
        facebookTitle: facebookOverrides?.title,
        facebookPageId: facebookOverrides?.pageId,
        facebookLinkUrl: facebookOverrides?.linkUrl,
      },
      onProgress,
    );
  } else if (validatedInput.kind === "photos") {
    emitProgress(
      onProgress,
      "publish.submitting",
      "Submitting photo post to Upload Post.",
      undefined,
      requestId,
    );
    response = await uploadPhotos(
      client,
      {
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
      },
      onProgress,
    );
  } else {
    emitProgress(
      onProgress,
      "publish.submitting",
      "Submitting video post to Upload Post.",
      undefined,
      requestId,
    );
    response = await uploadVideo(
      client,
      {
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
      },
      onProgress,
    );
  }

  if (isSyncResponse(response)) {
    emitProgress(
      onProgress,
      "publish.sync_completed",
      `Upload Post completed synchronously for request ${requestId}.`,
      response,
      requestId,
    );
    return normalizeSyncResponse(response, validatedInput, requestId);
  }

  if (isAsyncResponse(response)) {
    emitProgress(
      onProgress,
      "publish.accepted",
      `Upload Post accepted request ${response.request_id ?? requestId} and is processing it asynchronously.`,
      response,
      response.request_id,
    );

    const finalStatus = await client.pollStatus(
      response.request_id!,
      {
        intervalMs: dependencies.pollIntervalMs ?? 1_000,
        timeoutMs: dependencies.pollTimeoutMs ?? 60_000,
      },
      onProgress,
    );

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
      response.request_id,
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
      const logger = options.logger ?? console;
      const progressReporter = mergeProgressReporters(
        createInternalProgressReporter(options.showLogs ?? false, logger),
        options.onProgress,
      );

      emitProgress(progressReporter, "validation.started", "Validating publish input.");
      try {
        const validatedInput = validatePublishInput(input, platformSelection);
        emitProgress(
          progressReporter,
          "validation.completed",
          `Validation passed for ${validatedInput.kind} publish request.`,
          {
            requestedPlatforms: validatedInput.requestedPlatforms,
            publishablePlatforms: validatedInput.publishablePlatforms,
            skippedPlatforms: validatedInput.skippedPlatforms,
          },
        );
        const result = await executePublish(validatedInput, dependencies, progressReporter);
        if (options.showSummary !== false) {
          printPublishSummary(logger, result);
        }
        return result;
      } catch (error) {
        const normalizedError = toPublishError(error);
        emitProgress(
          progressReporter,
          "publish.failed",
          `Publish failed: ${normalizedError.message}`,
          normalizedError,
        );
        try {
          const validatedInput = validatePublishInput(input, platformSelection);
          const result = buildErrorResult(
            validatedInput.requestedPlatforms,
            normalizedError,
            validatedInput.skippedPlatforms,
          );
          if (options.showSummary !== false) {
            printPublishSummary(logger, result);
          }
          return result;
        } catch {
          const requestedPlatforms = selectedPlatformsFromSelection(
            resolvePlatformSelection(input.platforms, platformSelection),
          );
          const result = buildErrorResult(requestedPlatforms, normalizedError);
          if (options.showSummary !== false) {
            printPublishSummary(logger, result);
          }
          return result;
        }
      }
    },

    async getPublishStatus(requestId: string): Promise<PublishResult> {
      try {
        const client = createClient(dependencies);
        const response = await getUploadStatus(client, requestId);
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
  return createPublisherService({
    apiKey: env.apiKey,
    profile: env.profile,
    baseUrl: env.baseUrl,
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
