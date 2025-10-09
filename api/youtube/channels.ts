import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { accessToken } = req.query;

  if (!accessToken || typeof accessToken !== 'string') {
    return res.status(400).json({ error: 'Access token is required.' });
  }

  try {
    const youtubeApiUrl = 'https://www.googleapis.com/youtube/v3/channels';
    const params = new URLSearchParams({
      part: 'snippet,contentDetails',
      mine: 'true',
    });

    const response = await fetch(`${youtubeApiUrl}?${params.toString()}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(`YouTube API Error: ${errorData.error?.message || errorData.message}`);
    }

    const data = await response.json();

    res.status(200).json(data.items?.map((channel: any) => ({
      id: channel.id,
      title: channel.snippet?.title,
      thumbnail: channel.snippet?.thumbnails?.default?.url,
    })) || []);

  } catch (error: any) {
    console.error('Error fetching YouTube channels from backend:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch YouTube channels.' });
  }
}
