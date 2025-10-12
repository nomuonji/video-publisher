import fetch, { type Response } from "node-fetch";

const GRAPH_API_URL = "https://graph.facebook.com/v19.0";
const GRAPH_VIDEO_API_URL = "https://graph-video.facebook.com/v19.0";
const DEFAULT_RETRY_INTERVAL_MS = 6000;

export interface InstagramPostParams {
  accessToken: string;
  instagramAccountId: string;
  videoBuffer: Buffer;
  caption: string;
  isAiGenerated?: boolean;
  videoName?: string;
  videoId?: string;
  coverUrl?: string;
  thumbOffsetSeconds?: number;
  shareToFeed?: boolean;
  videoWidth?: number;
  videoHeight?: number;
  videoDurationSeconds?: number;
}

export interface InstagramPostOptions {
  fetchImpl?: typeof fetch;
  logger?: Pick<typeof console, "log" | "warn">;
  delayFn?: (ms: number) => Promise<void>;
}

interface UploadSessionInfo {
  uploadSessionId: string;
  uploadUrl: string;
  prePublishVideoId?: string;
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function toJson(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function assertSessionPayload(data: any): UploadSessionInfo {
  const uploadSessionId = data?.upload_session_id ?? data?.id;
  const uploadUrl = data?.upload_url ?? data?.uri;
  if (!uploadSessionId) {
    throw new Error(`upload_session_id missing in response: ${JSON.stringify(data)}`);
  }
  if (!uploadUrl) {
    throw new Error(`upload_url missing in response: ${JSON.stringify(data)}`);
  }
  return {
    uploadSessionId,
    uploadUrl,
    prePublishVideoId: data?.video_id ?? data?.id,
  };
}

export async function postVideoToInstagram(
  params: InstagramPostParams,
  options: InstagramPostOptions = {},
): Promise<any> {
  const {
    accessToken,
    instagramAccountId,
    videoBuffer,
    caption,
    isAiGenerated,
    videoName,
    videoId,
    coverUrl,
    thumbOffsetSeconds,
    shareToFeed,
    videoWidth,
    videoHeight,
    videoDurationSeconds,
  } = params;
  const fetchImpl = options.fetchImpl ?? fetch;
  const logger = options.logger ?? console;
  const delayFn = options.delayFn ?? delay;

  logger.log("[instagram] === Start posting sequence ===");

  const startEndpoint = `${GRAPH_VIDEO_API_URL}/${instagramAccountId}/media`;
  const startParams = new URLSearchParams();
  startParams.set("access_token", accessToken);
  startParams.set("media_type", "REELS");
  startParams.set("upload_phase", "start");
  startParams.set("upload_type", "resumable");
  startParams.set("file_size", videoBuffer.length.toString());

  logger.log("[instagram] POST %s", startEndpoint);
  logger.log("[instagram] Request params: %s", startParams.toString());

  const startResponse = await fetchImpl(startEndpoint, {
    method: "POST",
    body: startParams,
  });
  const startData: any = await toJson(startResponse);
  logger.log("[instagram] Response status: %s", startResponse.status);
  logger.log("[instagram] Response body:", startData);
  if (!startResponse.ok) {
    throw new Error(
      `Failed to start upload session: ${
        startData?.error?.message ?? JSON.stringify(startData) ?? "Unknown error"
      }`,
    );
  }

  const { uploadSessionId, uploadUrl, prePublishVideoId } = assertSessionPayload(startData);
  logger.log("[instagram] Upload session id: %s", uploadSessionId);
  logger.log("[instagram] Upload url: %s", uploadUrl);

  const entityName = videoName ?? uploadSessionId;
  const resolvedWidth = videoWidth && videoWidth > 0 ? videoWidth : 1080;
  const resolvedHeight = videoHeight && videoHeight > 0 ? videoHeight : 1920;
  const aspectRatio = resolvedWidth > 0 ? parseFloat((resolvedHeight / resolvedWidth).toFixed(3)) : 0;

  const uploadMediaSpec: Record<string, number> & {
    media_type: number;
    original_width: number;
    original_height: number;
    aspect_ratio: number;
  } = {
    media_type: 2,
    original_width: resolvedWidth,
    original_height: resolvedHeight,
    aspect_ratio: aspectRatio,
  };
  if (typeof videoDurationSeconds === "number" && videoDurationSeconds > 0) {
    uploadMediaSpec.duration_ms = Math.round(videoDurationSeconds * 1000);
  }

  const baseRuploadParams = {
    upload_id: uploadSessionId,
    media_type: "2",
    name: entityName,
    chunk_retry_interval: DEFAULT_RETRY_INTERVAL_MS,
    xsharing_user_ids: `["${instagramAccountId}"]`,
    upload_file_size: videoBuffer.length.toString(),
    upload_media_spec: JSON.stringify(uploadMediaSpec),
    retry_context: JSON.stringify({
      num_step_auto_retry: 0,
      num_reupload: 0,
      num_step_manual_retry: 0,
    }),
  };

  const totalSize = videoBuffer.length;
  const chunkSize = 4 * 1024 * 1024;
  let offset = 0;
  let chunkIndex = 0;

  while (offset < totalSize) {
    const end = Math.min(offset + chunkSize, totalSize);
    const chunk = videoBuffer.subarray(offset, end);
    const chunkParams = {
      ...baseRuploadParams,
      is_last: end === totalSize ? "1" : "0",
      chunk_sequence_number: chunkIndex.toString(),
      chunk_length: chunk.length.toString(),
    };
    const chunkHeaders: Record<string, string> = {
      Authorization: `OAuth ${accessToken}`,
      "Content-Type": "application/octet-stream",
      Offset: offset.toString(),
      "Content-Length": chunk.length.toString(),
      "Content-Range": `bytes ${offset}-${end - 1}/${totalSize}`,
      "X-Instagram-Rupload-Params": JSON.stringify(chunkParams),
      "X-Entity-Name": entityName,
      "X-Entity-Type": "video/mp4",
      "X-Entity-Length": totalSize.toString(),
      "X-Entity-Offset": offset.toString(),
    };

    logger.log("[instagram] Upload chunk %d-%d (%d bytes)", offset, end - 1, chunk.length);
    logger.log("[instagram] Chunk headers:", chunkHeaders);

    let attempt = 0;
    while (true) {
      const uploadResponse = await fetchImpl(uploadUrl, {
        method: "POST",
        headers: chunkHeaders,
        body: chunk,
      });

      const responseHeaders: Record<string, string> = {};
      uploadResponse.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      const uploadBodyText = await uploadResponse.text();
      let uploadData: any = {};
      try {
        uploadData = uploadBodyText ? JSON.parse(uploadBodyText) : {};
      } catch {
        uploadData = uploadBodyText;
      }

      logger.log("[instagram] Chunk response status: %s", uploadResponse.status);
      logger.log("[instagram] Chunk response headers:", responseHeaders);
      logger.log("[instagram] Chunk response body:", uploadData);

      if (uploadResponse.ok) {
        break;
      }

      const retryable =
        typeof uploadData === "object" &&
        uploadData?.debug_info?.retriable !== false &&
        attempt < 2;

      if (retryable) {
        logger.warn?.("[instagram] Retrying chunk upload due to API response");
        attempt += 1;
        await delayFn(DEFAULT_RETRY_INTERVAL_MS);
        continue;
      }

      const message = typeof uploadData === "object" && uploadData?.debug_info?.message
        ? uploadData.debug_info.message
        : uploadBodyText || "Unknown error";
      throw new Error(`Instagram video upload failed: ${message}`);
    }

    offset = end;
    chunkIndex += 1;

    if (offset < totalSize) {
      await delayFn(500);
    }
  }

  const finishParams = new URLSearchParams();
  finishParams.set("media_type", "REELS");
  finishParams.set("video_type", "REELS");
  finishParams.set("clips_subtype", "REELS");
  finishParams.set("access_token", accessToken);
  finishParams.set("upload_phase", "finish");
  finishParams.set("upload_session_id", uploadSessionId);
  finishParams.set("caption", caption);
  if (prePublishVideoId) {
    finishParams.set("video_id", prePublishVideoId);
  }
  finishParams.set("video_url", uploadUrl);
  if (typeof isAiGenerated === "boolean") {
    finishParams.set("is_ai_generated", isAiGenerated ? "true" : "false");
  }
  if (typeof thumbOffsetSeconds === "number") {
    finishParams.set("thumb_offset", Math.max(0, Math.floor(thumbOffsetSeconds)).toString());
  } else {
    finishParams.set("thumb_offset", "0");
  }
  if (coverUrl) {
    finishParams.set("cover_url", coverUrl);
  }
  if (typeof shareToFeed === "boolean") {
    finishParams.set("share_to_feed", shareToFeed ? "true" : "false");
  }

  logger.log("[instagram] Finishing upload session...");
  logger.log("[instagram] Finish params:", finishParams.toString());
  const finishResponse = await fetchImpl(startEndpoint, {
    method: "POST",
    body: finishParams,
  });
  const finishData: any = await toJson(finishResponse);
  logger.log("[instagram] Finish response status: %s", finishResponse.status);
  logger.log("[instagram] Finish response body:", finishData);
  if (!finishResponse.ok) {
    throw new Error(
      `Instagram upload finish failed: ${
        finishData?.error?.message ?? JSON.stringify(finishData) ?? "Unknown error"
      }`,
    );
  }

  let creationId: string | undefined =
    finishData?.id ?? finishData?.video_id ?? finishData?.creation_id ?? uploadSessionId;
  let statusCode: string | undefined =
    finishData?.status_code ?? finishData?.status ?? finishData?.upload_status;
  const pendingStatuses = new Set(["IN_PROGRESS", "PROCESSING", "PENDING", "UPLOADING"]);
  const successStatuses = new Set(["FINISHED", "SUCCESS", "COMPLETED"]);

  if (!statusCode || pendingStatuses.has(statusCode.toUpperCase())) {
    logger.log("[instagram] Polling processing status...");
    const statusParams = new URLSearchParams();
    statusParams.set("access_token", accessToken);
    statusParams.set("fields", "status,status_code");

    while (true) {
      await delayFn(5000);
      const statusUrl = `${GRAPH_VIDEO_API_URL}/${uploadSessionId}`;
      const statusResponse = await fetchImpl(`${statusUrl}?${statusParams.toString()}`);
      const statusData: any = await toJson(statusResponse);
      logger.log("[instagram] Status response: %s", statusResponse.status);
      logger.log("[instagram] Status body:", statusData);
      if (!statusResponse.ok) {
        throw new Error(
          `Instagram status polling failed: ${
            statusData?.error?.message ?? JSON.stringify(statusData) ?? "Unknown error"
          }`,
        );
      }
      statusCode = statusData?.status_code ?? statusData?.status ?? statusData?.upload_status;
      creationId = statusData?.id ?? statusData?.video_id ?? statusData?.creation_id ?? creationId;
      if (!statusCode) {
        continue;
      }
      const upper = statusCode.toUpperCase();
      if (successStatuses.has(upper)) {
        break;
      }
      if (!pendingStatuses.has(upper)) {
        throw new Error(`Instagram upload session ended with unexpected status: ${statusCode}`);
      }
    }
  }

  logger.log("[instagram] Upload session finished with status: %s", statusCode ?? "UNKNOWN");
  logger.log("[instagram] Creation id for publish: %s", creationId);

  const publishEndpoint = `${GRAPH_API_URL}/${instagramAccountId}/media_publish`;
  if (!creationId) {
    throw new Error("Instagram upload finished but creation_id could not be determined.");
  }

  const publishParams = new URLSearchParams();
  publishParams.set("access_token", accessToken);
  publishParams.set("creation_id", creationId);

  logger.log("[instagram] Publishing media container...");
  const publishResponse = await fetchImpl(publishEndpoint, {
    method: "POST",
    body: publishParams,
  });
  const publishData: any = await toJson(publishResponse);
  logger.log("[instagram] Publish response status: %s", publishResponse.status);
  logger.log("[instagram] Publish response body:", publishData);
  if (!publishResponse.ok) {
    throw new Error(
      `Instagram publish failed: ${
        publishData?.error?.message ?? JSON.stringify(publishData) ?? "Unknown error"
      }`,
    );
  }

  logger.log("[instagram] === Posting sequence finished ===");
  return publishData;
}
