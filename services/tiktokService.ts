
import fetch from 'node-fetch';

const TIKTOK_API_BASE_URL = 'https://open.tiktokapis.com';

interface UploadParams {
  accessToken: string;
  openId: string;
  videoUrl: string;
}

// This is a simplified example. In a real application, you would need to handle errors and edge cases.
export async function uploadVideoToTiktok({ accessToken, openId, videoUrl }: UploadParams): Promise<unknown> {
  const uploadEndpoint = `${TIKTOK_API_BASE_URL}/v2/post/publish/video/init/`;

  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json; charset=UTF-8',
  };

  const body = JSON.stringify({
    post_info: {
      title: 'My Awesome Video', // TODO: Get title from user
      description: 'Check out this great video!', // TODO: Get description from user
      privacy_level: 'PUBLIC_TO_EVERYONE',
    },
    source_info: {
      source: 'PULL_FROM_URL',
      video_url: videoUrl,
    },
    user_info: {
        open_id: openId,
    }
  });

  const response = await fetch(uploadEndpoint, {
    method: 'POST',
    headers,
    body,
  });

  const data = await response.json();

  if (data.error.code !== 'ok') {
    throw new Error(`Failed to initialize video upload: ${data.error.message}`);
  }

  // The video is now being processed by TikTok. The user will be notified to complete the post.
  return data.data;
}
