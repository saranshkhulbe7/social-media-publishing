import { basename } from "node:path";

import type {
  PlatformName,
  PublishProgressEvent,
  UploadPostAsyncResponse,
  UploadPostStatusResponse,
  UploadPostSyncResponse,
} from "../../domain/types.ts";
import { isUrl } from "../../domain/validation.ts";
import { UploadPostClient } from "./client.ts";

type ProgressReporter = ((event: PublishProgressEvent) => void) | undefined;

export interface UploadTextRequest {
  user: string;
  caption: string;
  requestId: string;
  platforms: PlatformName[];
  xTitle?: string;
  xLongTextAsPost?: boolean;
  facebookTitle?: string;
  facebookPageId?: string;
  facebookLinkUrl?: string;
}

export interface UploadPhotosRequest {
  user: string;
  caption: string;
  media: string[];
  requestId: string;
  platforms: PlatformName[];
  xTitle?: string;
  instagramTitle?: string;
  xLongTextAsPost?: boolean;
  facebookTitle?: string;
  facebookDescription?: string;
  facebookPageId?: string;
  facebookMediaType?: "POSTS" | "STORIES";
}

export interface UploadVideoRequest {
  user: string;
  caption: string;
  media: string;
  requestId: string;
  platforms: PlatformName[];
  xTitle?: string;
  instagramTitle?: string;
  xLongTextAsPost?: boolean;
  instagramMediaType: "REELS" | "STORIES";
  shareToFeed: boolean;
  facebookTitle?: string;
  facebookDescription?: string;
  facebookPageId?: string;
  facebookMediaType?: "REELS" | "STORIES" | "VIDEO";
  facebookVideoState?: "DRAFT" | "PUBLISHED";
  facebookThumbnailUrl?: string;
}

type UploadPostResponse = UploadPostSyncResponse | UploadPostAsyncResponse;

function appendValue(
  formData: FormData,
  key: string,
  value: string | number | boolean | undefined,
): void {
  if (value === undefined) {
    return;
  }

  formData.append(key, String(value));
}

function appendPlatform(formData: FormData, platform: string): void {
  formData.append("platform[]", platform);
}

function appendMediaReference(
  formData: FormData,
  fieldName: string,
  reference: string,
): void {
  if (isUrl(reference)) {
    formData.append(fieldName, reference);
    return;
  }

  formData.append(fieldName, Bun.file(reference), basename(reference));
}

export async function uploadText(
  client: UploadPostClient,
  request: UploadTextRequest,
  onProgress?: ProgressReporter,
): Promise<UploadPostResponse> {
  const formData = new FormData();
  formData.append("user", request.user);
  for (const platform of request.platforms) {
    appendPlatform(formData, platform);
  }
  formData.append("title", request.caption);
  formData.append("async_upload", "true");
  formData.append("request_id", request.requestId);
  appendValue(formData, "x_title", request.xTitle);
  appendValue(formData, "x_long_text_as_post", request.xLongTextAsPost);
  appendValue(formData, "facebook_title", request.facebookTitle);
  appendValue(formData, "facebook_page_id", request.facebookPageId);
  appendValue(formData, "facebook_link_url", request.facebookLinkUrl);

  return client.postMultipart(
    "/upload_text",
    formData,
    request.requestId,
    onProgress,
  ) as Promise<UploadPostResponse>;
}

export async function uploadPhotos(
  client: UploadPostClient,
  request: UploadPhotosRequest,
  onProgress?: ProgressReporter,
): Promise<UploadPostResponse> {
  const formData = new FormData();
  formData.append("user", request.user);
  for (const platform of request.platforms) {
    appendPlatform(formData, platform);
  }
  formData.append("title", request.caption);
  formData.append("async_upload", "true");
  formData.append("request_id", request.requestId);
  appendValue(formData, "x_title", request.xTitle);
  appendValue(formData, "instagram_title", request.instagramTitle);
  appendValue(formData, "x_long_text_as_post", request.xLongTextAsPost);
  appendValue(formData, "facebook_title", request.facebookTitle);
  appendValue(formData, "facebook_description", request.facebookDescription);
  appendValue(formData, "facebook_page_id", request.facebookPageId);
  appendValue(formData, "facebook_media_type", request.facebookMediaType);

  for (const reference of request.media) {
    appendMediaReference(formData, "photos[]", reference);
  }

  return client.postMultipart(
    "/upload_photos",
    formData,
    request.requestId,
    onProgress,
  ) as Promise<UploadPostResponse>;
}

export async function uploadVideo(
  client: UploadPostClient,
  request: UploadVideoRequest,
  onProgress?: ProgressReporter,
): Promise<UploadPostResponse> {
  const formData = new FormData();
  formData.append("user", request.user);
  for (const platform of request.platforms) {
    appendPlatform(formData, platform);
  }
  formData.append("title", request.caption);
  formData.append("async_upload", "true");
  formData.append("request_id", request.requestId);
  appendValue(formData, "x_title", request.xTitle);
  appendValue(formData, "instagram_title", request.instagramTitle);
  appendValue(formData, "x_long_text_as_post", request.xLongTextAsPost);
  appendValue(formData, "media_type", request.instagramMediaType);
  appendValue(formData, "share_to_feed", request.shareToFeed);
  appendValue(formData, "facebook_title", request.facebookTitle);
  appendValue(formData, "facebook_description", request.facebookDescription);
  appendValue(formData, "facebook_page_id", request.facebookPageId);
  appendValue(formData, "facebook_media_type", request.facebookMediaType);
  appendValue(formData, "video_state", request.facebookVideoState);
  appendValue(formData, "thumbnail_url", request.facebookThumbnailUrl);
  appendMediaReference(formData, "video", request.media);

  return client.postMultipart(
    "/upload",
    formData,
    request.requestId,
    onProgress,
  ) as Promise<UploadPostResponse>;
}

export async function getStatus(
  client: UploadPostClient,
  requestId: string,
): Promise<UploadPostStatusResponse> {
  return client.getJson("/uploadposts/status", {
    request_id: requestId,
  }) as Promise<UploadPostStatusResponse>;
}
