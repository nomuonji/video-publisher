import { Response } from "node-fetch";
import { postVideoToInstagram } from "../services/instagramService.js";

interface RecordedRequest {
  url: string;
  method: string;
  body?: string;
  headers?: Record<string, string>;
}

async function runInstagramFlowTest(): Promise<void> {
  const recorded: RecordedRequest[] = [];
  const uploadSessionId = "17890123456789012";
  const uploadUrl = "https://upload.facebook.com/mock-session";
  const creationId = "18001234567890000";
  const publishId = "17900987654321000";
  const accessToken = "mock-access-token";
  const instagramAccountId = "1234567890";

  const pollResponses = [
    { status_code: "IN_PROGRESS" },
    { status_code: "FINISHED" },
  ];

  const fetchMock: (input: RequestInfo, init?: RequestInit) => Promise<Response> = async (input, init) => {
    const method = init?.method ?? "GET";
    const headers: Record<string, string> = {};
    if (init?.headers) {
      for (const [key, value] of Object.entries(init.headers as Record<string, string>)) {
        headers[key.toLowerCase()] = value;
      }
    }

    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : (input as Request).url;

    let bodyText: string | undefined;
    if (init?.body instanceof URLSearchParams) {
      bodyText = init.body.toString();
    } else if (typeof init?.body === "string") {
      bodyText = init.body;
    }

    recorded.push({ url, method, body: bodyText, headers });

    if (method === "POST" && url.endsWith(`/${instagramAccountId}/media`)) {
      if (bodyText?.includes("upload_phase=start")) {
        if (!bodyText.includes("file_size=")) {
          throw new Error("start call missing file_size parameter");
        }
        if (!bodyText.includes("upload_type=resumable")) {
          throw new Error("start call missing upload_type=resumable");
        }
        return new Response(
          JSON.stringify({ upload_session_id: uploadSessionId, upload_url: uploadUrl }),
          { status: 200 },
        );
      }

      if (bodyText?.includes("upload_phase=finish")) {
        if (!bodyText.includes(`upload_session_id=${uploadSessionId}`)) {
          throw new Error("finish call missing upload_session_id");
        }
        if (!bodyText.includes("media_type=REELS")) {
          throw new Error("finish call missing media_type=REELS");
        }
        if (!bodyText.includes("video_type=REELS")) {
          throw new Error("finish call missing video_type=REELS");
        }
        if (!bodyText.includes("clips_subtype=REELS")) {
          throw new Error("finish call missing clips_subtype=REELS");
        }
        if (!bodyText.includes("thumb_offset=")) {
          throw new Error("finish call missing thumb_offset");
        }
        if (!bodyText.includes("caption=Test+caption")) {
          throw new Error("finish call missing caption");
        }
        return new Response(JSON.stringify({ status_code: "IN_PROGRESS", id: creationId }), { status: 200 });
      }

      throw new Error("Unexpected upload_phase value");
    }

    if (method === "POST" && url === uploadUrl) {
      const ruploadRaw = headers["x-instagram-rupload-params"];
      if (!ruploadRaw) {
        throw new Error("upload call missing X-Instagram-Rupload-Params header");
      }
      if (headers["offset"] !== "0") {
        throw new Error("upload call must use offset: 0 header");
      }
      if (!headers["content-length"]) {
        throw new Error("upload call missing Content-Length header");
      }
      if (!headers["content-range"]) {
        throw new Error("upload call missing Content-Range header");
      }
      const rupload = JSON.parse(ruploadRaw);
      if (rupload.media_type !== "2") {
        throw new Error("X-Instagram-Rupload-Params media_type must be \"2\" for videos");
      }
      const mediaSpec = JSON.parse(rupload.upload_media_spec);
      if (mediaSpec.original_width !== 1080 || mediaSpec.original_height !== 1920) {
        throw new Error("upload_media_spec dimensions did not propagate");
      }
      if (mediaSpec.duration_ms !== 12000) {
        throw new Error("upload_media_spec duration_ms did not propagate");
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }

    if (method === "GET" && url.startsWith(`https://graph-video.facebook.com/v19.0/${uploadSessionId}`)) {
      const next = pollResponses.shift();
      return new Response(JSON.stringify(next ?? { status_code: "FINISHED" }), { status: 200 });
    }

    if (method === "POST" && url.endsWith(`/${instagramAccountId}/media_publish`)) {
      if (!bodyText?.includes(`creation_id=${creationId}`)) {
        throw new Error("publish call missing creation_id");
      }
      return new Response(JSON.stringify({ id: publishId }), { status: 200 });
    }

    throw new Error(`Unexpected request in mock: ${method} ${input}`);
  };

  const logger = {
    log: () => undefined,
    warn: () => undefined,
  };

  process.env.INSTAGRAM_REPLAY_DIR = "disable";

  const result = await postVideoToInstagram(
    {
      accessToken,
      instagramAccountId,
      caption: "Test caption",
      videoBuffer: Buffer.from("dummy-mp4"),
      isAiGenerated: true,
      videoName: "dummy.mp4",
      videoId: "mock-video-id",
      coverUrl: "https://example.com/cover.jpg",
      thumbOffsetSeconds: 3,
      videoWidth: 1080,
      videoHeight: 1920,
      videoDurationSeconds: 12,
    },
    {
      fetchImpl: fetchMock as any,
      logger,
      delayFn: async () => undefined,
    },
  );

  if (!result || result.id !== publishId) {
    throw new Error(`Unexpected test result: ${JSON.stringify(result)}`);
  }

  const requiredStages = [
    `https://graph-video.facebook.com/v19.0/${instagramAccountId}/media`,
    uploadUrl,
    `https://graph-video.facebook.com/v19.0/${instagramAccountId}/media`,
    `https://graph-video.facebook.com/v19.0/${uploadSessionId}`,
    `https://graph-video.facebook.com/v19.0/${uploadSessionId}`,
    `https://graph.facebook.com/v19.0/${instagramAccountId}/media_publish`,
  ];

  for (const stageUrl of requiredStages) {
    if (!recorded.some(r => r.url === stageUrl || r.url.startsWith(`${stageUrl}?`))) {
      throw new Error(`Expected request was not observed: ${stageUrl}`);
    }
  }

  console.log("✅ postVideoToInstagram mock test passed");
}

runInstagramFlowTest().catch(error => {
  console.error("❌ postVideoToInstagram mock test failed", error);
  process.exitCode = 1;
});
