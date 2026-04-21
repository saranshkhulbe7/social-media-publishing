import type {
  PublishProgressEvent,
  UploadPostStatusResponse,
} from "../../domain/types.ts";

type UploadPostFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface UploadPostClientOptions {
  apiKey: string;
  baseUrl: string;
  fetchImpl?: UploadPostFetch;
}

export interface PollStatusOptions {
  intervalMs: number;
  timeoutMs: number;
}

type ProgressReporter = ((event: PublishProgressEvent) => void) | undefined;

export class UploadPostApiError extends Error {
  override name = "UploadPostApiError";

  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
    public readonly url: string,
  ) {
    super(message);
  }
}

export class UploadPostPollingError extends Error {
  override name = "UploadPostPollingError";

  constructor(
    message: string,
    public readonly requestId: string,
    public readonly lastResponse?: UploadPostStatusResponse,
  ) {
    super(message);
  }
}

export class UploadPostClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: UploadPostFetch;

  constructor(options: UploadPostClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  generateRequestId(): string {
    return crypto.randomUUID();
  }

  async postMultipart(
    path: string,
    formData: FormData,
    requestId?: string,
    onProgress?: ProgressReporter,
  ): Promise<unknown> {
    return this.request(path, {
      method: "POST",
      headers: this.buildHeaders(requestId),
      body: formData,
    }, onProgress);
  }

  async getJson(
    path: string,
    query?: Record<string, string | undefined>,
    onProgress?: ProgressReporter,
  ): Promise<unknown> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value) {
        url.searchParams.set(key, value);
      }
    }

    return this.request(url.toString(), {
      method: "GET",
      headers: this.buildHeaders(),
    }, onProgress);
  }

  async pollStatus(
    requestId: string,
    options: PollStatusOptions,
    onProgress?: ProgressReporter,
  ): Promise<UploadPostStatusResponse> {
    const startedAt = Date.now();
    let lastResponse: UploadPostStatusResponse | undefined;

    this.emitProgress(onProgress, {
      stage: "polling.started",
      message: `Started polling Upload Post status for request ${requestId}.`,
      requestId,
    });

    while (Date.now() - startedAt <= options.timeoutMs) {
      const response = (await this.getJson("/uploadposts/status", {
        request_id: requestId,
      }, onProgress)) as UploadPostStatusResponse;
      lastResponse = response;

      this.emitProgress(onProgress, {
        stage: "polling.tick",
        message: `Upload Post status is ${response.status ?? "unknown"} for request ${requestId}.`,
        requestId,
        details: response,
      });

      if (response.status === "completed") {
        return response;
      }

      await Bun.sleep(options.intervalMs);
    }

    throw new UploadPostPollingError(
      `Timed out while waiting for Upload Post request ${requestId} to complete.`,
      requestId,
      lastResponse,
    );
  }

  private async request(
    pathOrUrl: string,
    init: RequestInit,
    onProgress?: ProgressReporter,
  ): Promise<unknown> {
    const url = pathOrUrl.startsWith("http")
      ? pathOrUrl
      : `${this.baseUrl}${pathOrUrl}`;

    this.emitProgress(onProgress, {
      stage: "request.started",
      message: `Sending ${init.method ?? "GET"} request to ${url}.`,
    });

    let response: Response;
    try {
      response = await this.fetchImpl(url, init);
    } catch (error) {
      throw error;
    }

    const body = await this.parseJsonResponse(response);
    this.emitProgress(onProgress, {
      stage: "request.completed",
      message: `Received HTTP ${response.status} from ${url}.`,
      details: body,
    });

    if (!response.ok) {
      const message =
        this.extractMessageFromBody(body) ??
        `Upload Post request failed with status ${response.status}`;

      throw new UploadPostApiError(message, response.status, body, url);
    }

    return body;
  }

  private buildHeaders(requestId?: string): HeadersInit {
    const headers: Record<string, string> = {
      Authorization: `Apikey ${this.apiKey}`,
    };

    if (requestId) {
      headers["Idempotency-Key"] = requestId;
      headers["X-Request-Id"] = requestId;
    }

    return headers;
  }

  private async parseJsonResponse(response: Response): Promise<unknown> {
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      const text = await response.text();
      return text ? { message: text } : {};
    }

    return response.json();
  }

  private extractMessageFromBody(body: unknown): string | undefined {
    if (!body || typeof body !== "object" || !("message" in body)) {
      return undefined;
    }

    const { message } = body as { message?: unknown };
    return typeof message === "string" ? message : undefined;
  }

  private emitProgress(
    onProgress: ProgressReporter,
    event: PublishProgressEvent,
  ): void {
    onProgress?.(event);
  }
}
