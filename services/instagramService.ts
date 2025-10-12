import fetch, { type Response } from "node-fetch";

const GRAPH_API_URL = "https://graph.facebook.com/v19.0";
const GRAPH_VIDEO_API_URL = "https://graph-video.facebook.com/v19.0";
const DEFAULT_RETRY_INTERVAL_MS = 6000;

type InstagramLogger = Pick<typeof console, "log" | "warn" | "error">;

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
  logger?: InstagramLogger;
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

function assertSessionPayload(logger: InstagramLogger, data: any): UploadSessionInfo {
  const uploadSessionId = data?.upload_session_id ?? data?.id;
  const uploadUrl = data?.upload_url ?? data?.uri;
  if (!uploadSessionId) {
    const message = `upload_session_id missing in response: ${JSON.stringify(data)}`;
    logger.error?.(`[instagram] ${message}`);
    throw new Error(message);
  }
  if (!uploadUrl) {
    const message = `upload_url missing in response: ${JSON.stringify(data)}`;
    logger.error?.(`[instagram] ${message}`);
    throw new Error(message);
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
  const logger: InstagramLogger = options.logger ?? console;
  const delayFn = options.delayFn ?? delay;

  logger.log("[instagram] === Start posting sequence ===");
  if (videoId) {
    logger.log("[instagram] Source video identifier: %s", videoId);
  }

  const startEndpoint = `${GRAPH_VIDEO_API_URL}/${instagramAccountId}/media`;
  const startPayload = {
    access_token: accessToken,
    media_type: "REELS",
    upload_phase: "start",
    upload_type: "resumable",
    file_size: videoBuffer.length,
    caption,
  };
  if (typeof isAiGenerated === "boolean") {
    (startPayload as Record<string, any>).is_ai_generated = isAiGenerated;
  }

  logger.log("[instagram] POST %s", startEndpoint);
  logger.log("[instagram] Request payload:", { ...startPayload, access_token: "***" });

  const startResponse = await fetchImpl(startEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(startPayload),
  });
  const startData: any = await toJson(startResponse);
  logger.log("[instagram] Response status: %s", startResponse.status);
  logger.log("[instagram] Response body:", startData);
  if (!startResponse.ok) {
    const message = `Failed to start upload session: ${
      startData?.error?.message ?? JSON.stringify(startData) ?? "Unknown error"
    }`;
    logger.error?.(`[instagram] ${message}`);
    throw new Error(message);
  }

  const { uploadSessionId, uploadUrl, prePublishVideoId } = assertSessionPayload(logger, startData);
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

outer: while (offset < totalSize) {
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
        offset = end;
        chunkIndex += 1;
        break;
      }

      const debugInfo = typeof uploadData === "object" ? uploadData?.debug_info ?? {} : {};
      const errorMessage =
        typeof debugInfo?.message === "string"
          ? debugInfo.message
          : uploadBodyText || "Unknown error";
      const errorType = typeof debugInfo?.type === "string" ? debugInfo.type : undefined;
      let suggestedOffset: number | undefined;
      if (
        typeof uploadData === "object" &&
        uploadData !== null &&
        typeof (uploadData as any).offset === "number"
      ) {
        suggestedOffset = Math.max(0, (uploadData as any).offset);
      } else if (
        typeof uploadData === "object" &&
        uploadData !== null &&
        typeof (uploadData as any).start_offset === "number"
      ) {
        suggestedOffset = Math.max(0, (uploadData as any).start_offset);
      } else if (typeof errorMessage === "string") {
        const match = errorMessage.match(/Maximum accepted offset:\s*(\d+)/i);
        if (match) {
          suggestedOffset = Number(match[1]);
        }
      }

      const explicitlyRetryable = debugInfo?.retriable === true;
      const implicitlyRetryable =
        uploadResponse.status >= 500 ||
        (errorType && ["PartialRequestError", "ProcessingFailedError", "TranscodeError"].includes(errorType));
      const offsetMismatch =
        errorType === "OffsetInvalidError" ||
        (typeof errorMessage === "string" && /offset/i.test(errorMessage));

      if (offsetMismatch && typeof suggestedOffset === "number" && suggestedOffset !== offset) {
        logger.warn?.(
          "[instagram] Offset mismatch detected. Server expects %d but client had %d. Resyncing chunk position.",
          suggestedOffset,
          offset,
        );
        offset = suggestedOffset;
        chunkIndex = Math.floor(suggestedOffset / chunkSize);
        attempt = 0;
        await delayFn(DEFAULT_RETRY_INTERVAL_MS);
        continue outer;
      }

      if (attempt < 4 && (explicitlyRetryable || implicitlyRetryable)) {
        attempt += 1;
        const backoff = DEFAULT_RETRY_INTERVAL_MS * attempt;
        logger.warn?.(
          "[instagram] Chunk upload failed (%s). Retrying attempt %d after %d ms",
          errorMessage,
          attempt,
          backoff,
        );
        await delayFn(backoff);
        continue;
      }

      logger.error?.(`[instagram] Chunk upload failed permanently: ${errorMessage}`);
      throw new Error(`Instagram video upload failed: ${errorMessage}`);
    }

    if (offset < totalSize) {
      await delayFn(500);
    }
  }

  const finishPayload: Record<string, any> = {
    access_token: accessToken,
    upload_phase: "finish",
    upload_session_id: uploadSessionId,
    media_type: "REELS",
    video_type: "REELS",
    clips_subtype: "REELS",
    caption,
    video_url: uploadUrl,
  };
  if (prePublishVideoId) {
    finishPayload.video_id = prePublishVideoId;
  }
  if (typeof isAiGenerated === "boolean") {
    finishPayload.is_ai_generated = isAiGenerated;
  }
  finishPayload.thumb_offset =
    typeof thumbOffsetSeconds === "number" ? Math.max(0, Math.floor(thumbOffsetSeconds)) : 0;
  if (coverUrl) {
    finishPayload.cover_url = coverUrl;
  }
  if (typeof shareToFeed === "boolean") {
    finishPayload.share_to_feed = shareToFeed;
  }

  logger.log("[instagram] Finishing upload session...");
  logger.log("[instagram] Finish payload:", {
    ...finishPayload,
    access_token: "***",
    caption: caption.slice(0, 120),
  });

  const finishResponse = await fetchImpl(startEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(finishPayload),
  });
  const finishData: any = await toJson(finishResponse);
  logger.log("[instagram] Finish response status: %s", finishResponse.status);
  logger.log("[instagram] Finish response body:", finishData);
  if (!finishResponse.ok) {
    const message = `Instagram upload finish failed: ${
      finishData?.error?.message ?? JSON.stringify(finishData) ?? "Unknown error"
    }`;
    logger.error?.(`[instagram] ${message}`);
    throw new Error(message);
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
        const message = `Instagram status polling failed: ${
          statusData?.error?.message ?? JSON.stringify(statusData) ?? "Unknown error"
        }`;
        logger.error?.(`[instagram] ${message}`);
        throw new Error(message);
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
        const message = `Instagram upload session ended with unexpected status: ${statusCode}`;
        logger.error?.(`[instagram] ${message}`);
        throw new Error(message);
      }
    }
  }

  logger.log("[instagram] Upload session finished with status: %s", statusCode ?? "UNKNOWN");
  logger.log("[instagram] Creation id for publish: %s", creationId);

  const publishEndpoint = `${GRAPH_API_URL}/${instagramAccountId}/media_publish`;
  if (!creationId) {
    const message = "Instagram upload finished but creation_id could not be determined.";
    logger.error?.(`[instagram] ${message}`);
    throw new Error(message);
  }

  const publishBody = {
    access_token: accessToken,
    creation_id: creationId,
  };

  logger.log("[instagram] Publishing media container...");
  const publishResponse = await fetchImpl(publishEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(publishBody),
  });
  const publishData: any = await toJson(publishResponse);
  logger.log("[instagram] Publish response status: %s", publishResponse.status);
  logger.log("[instagram] Publish response body:", publishData);
  if (!publishResponse.ok) {
    const message = `Instagram publish failed: ${
      publishData?.error?.message ?? JSON.stringify(publishData) ?? "Unknown error"
    }`;
    logger.error?.(`[instagram] ${message}`);
    throw new Error(message);
  }

  logger.log("[instagram] === Posting sequence finished ===");
  return publishData;
}
