export type PlatformName = "x" | "instagram" | "facebook";

export type PublishResultStatus =
  | "success"
  | "partial_failure"
  | "failed"
  | "pending";

export type PlatformStatus =
  | "published"
  | "failed"
  | "skipped"
  | "pending"
  | "unknown";

export interface PlatformSelection {
  x?: boolean;
  instagram?: boolean;
  facebook?: boolean;
}

export interface PublishProgressEvent {
  stage: string;
  message: string;
  requestId?: string;
  details?: unknown;
}

export interface PublishOptions {
  onProgress?: (event: PublishProgressEvent) => void;
}

export interface PlatformOverrides {
  x?: {
    title?: string;
    longTextAsPost?: boolean;
  };
  instagram?: {
    title?: string;
    mediaType?: "REELS" | "STORIES" | "IMAGE";
    shareToFeed?: boolean;
  };
  facebook?: {
    title?: string;
    description?: string;
    pageId?: string;
    mediaType?: "POSTS" | "STORIES" | "REELS" | "VIDEO";
    videoState?: "DRAFT" | "PUBLISHED";
    thumbnailUrl?: string;
    linkUrl?: string;
  };
}

export type PublishInput =
  | {
      kind: "text";
      caption: string;
      platformOverrides?: PlatformOverrides;
      platforms?: PlatformSelection;
    }
  | {
      kind: "photos";
      caption: string;
      media: string[];
      platformOverrides?: PlatformOverrides;
      platforms?: PlatformSelection;
    }
  | {
      kind: "video";
      caption: string;
      media: string;
      platformOverrides?: PlatformOverrides;
      platforms?: PlatformSelection;
    };

export interface PublishError {
  code:
    | "validation_error"
    | "authentication_error"
    | "profile_not_found"
    | "monthly_limit_exceeded"
    | "rate_limited"
    | "network_error"
    | "publish_timeout"
    | "api_error"
    | "unexpected_response"
    | "platform_publish_failed";
  message: string;
  details?: unknown;
}

export interface PlatformResult {
  status: PlatformStatus;
  publishedUrl?: string;
  reason?: string;
  error?: PublishError;
  raw?: unknown;
}

export interface PublishResult {
  overallStatus: PublishResultStatus;
  requestedPlatforms: PlatformName[];
  requestId?: string;
  jobId?: string;
  error?: PublishError;
  platforms: Record<PlatformName, PlatformResult>;
  raw?: unknown;
}

export type MediaClassification = "image" | "video" | "unknown";

export interface ValidatedPublishInput {
  kind: PublishInput["kind"];
  caption: string;
  media: string[];
  requestedPlatforms: PlatformName[];
  publishablePlatforms: PlatformName[];
  skippedPlatforms: Partial<Record<PlatformName, string>>;
  platformOverrides?: PlatformOverrides;
}

export interface UploadPostPlatformResponse {
  success?: boolean;
  url?: string;
  error?: string;
  message?: string;
  [key: string]: unknown;
}

export interface UploadPostSyncResponse {
  success?: boolean;
  results?: Partial<Record<PlatformName, UploadPostPlatformResponse>>;
  usage?: unknown;
  [key: string]: unknown;
}

export interface UploadPostAsyncResponse {
  success?: boolean;
  message?: string;
  request_id?: string;
  total_platforms?: number;
  [key: string]: unknown;
}

export interface UploadPostStatusEntry {
  platform?: string;
  success?: boolean;
  message?: string;
  url?: string;
  error?: string;
  [key: string]: unknown;
}

export interface UploadPostStatusResponse {
  request_id?: string;
  job_id?: string;
  status?: "pending" | "in_progress" | "completed";
  completed?: number;
  total?: number;
  results?: UploadPostStatusEntry[];
  last_update?: string;
  [key: string]: unknown;
}
