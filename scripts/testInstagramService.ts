import { Response } from 'node-fetch';
import { postVideoToInstagram } from '../services/instagramService.js';

interface RecordedRequest {
  url: string;
  method: string;
  body?: string;
  headers?: Record<string, string>;
}

async function runInstagramFlowTest(): Promise<void> {
  const recorded: RecordedRequest[] = [];
  const uploadSessionId = '17890123456789012';
  const uploadUrl = 'https://upload.facebook.com/mock-session';
  const publishId = '17900987654321000';
  const accessToken = 'mock-access-token';
  const instagramAccountId = '1234567890';

  const pollResponses = [
    { status_code: 'IN_PROGRESS' },
    { status_code: 'FINISHED' },
  ];

  const fetchMock = async (input: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? 'GET';
    const headers: Record<string, string> = {};
    if (init?.headers) {
      for (const [key, value] of Object.entries(init.headers as Record<string, string>)) {
        headers[key.toLowerCase()] = value;
      }
    }

    let bodyText: string | undefined;
    if (init?.body instanceof URLSearchParams) {
      bodyText = init.body.toString();
    } else if (typeof init?.body === 'string') {
      bodyText = init.body;
    }

    recorded.push({
      url: input,
      method,
      body: bodyText,
      headers,
    });

    if (method === 'POST' && input.endsWith(`/${instagramAccountId}/media`)) {
      if (bodyText?.includes('upload_phase=start')) {
        if (!bodyText.includes('file_size=')) {
          throw new Error('start call missing file_size parameter');
        }
        return new Response(JSON.stringify({
          upload_session_id: uploadSessionId,
          upload_url: uploadUrl,
        }), { status: 200 });
      }

      if (bodyText?.includes('upload_phase=finish')) {
        if (!bodyText.includes(`upload_session_id=${uploadSessionId}`)) {
          throw new Error('finish call missing upload_session_id');
        }
        return new Response(JSON.stringify({ status_code: 'IN_PROGRESS' }), { status: 200 });
      }

      throw new Error('Unexpected upload_phase value');
    }

    if (method === 'POST' && input === uploadUrl) {
      if (headers['offset'] !== '0') {
        throw new Error('upload call must use Offset: 0 header');
      }
      if (!headers['content-length']) {
        throw new Error('upload call missing Content-Length header');
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }

    if (method === 'GET' && input.startsWith(`https://graph-video.facebook.com/v19.0/${uploadSessionId}`)) {
      const next = pollResponses.shift();
      return new Response(JSON.stringify(next ?? { status_code: 'FINISHED' }), { status: 200 });
    }

    if (method === 'POST' && input.endsWith(`/${instagramAccountId}/media_publish`)) {
      if (!bodyText?.includes(`creation_id=${uploadSessionId}`)) {
        throw new Error('publish call missing creation_id');
      }
      return new Response(JSON.stringify({ id: publishId }), { status: 200 });
    }

    throw new Error(`Unexpected request in mock: ${method} ${input}`);
  };

  const logger = {
    log: () => {
      /* swallow logs in test */
    },
    warn: () => {
      /* swallow warnings in test */
    },
  };

  process.env.INSTAGRAM_REPLAY_DIR = 'disable';

  const result = await postVideoToInstagram({
    accessToken,
    instagramAccountId,
    caption: 'テスト投稿',
    videoBuffer: Buffer.from('dummy-mp4'),
    isAiGenerated: true,
    videoName: 'dummy.mp4',
    videoId: 'mock-video-id',
  }, {
    fetchImpl: fetchMock,
    logger,
    delayFn: async () => {
      // Skip waiting during tests
    },
  });

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

  console.log('✅ postVideoToInstagram のモックテストが成功しました');
}

runInstagramFlowTest().catch(error => {
  console.error('❌ postVideoToInstagram テスト失敗', error);
  process.exitCode = 1;
});
