import type { VercelRequest, VercelResponse } from '@vercel/node';
import { performVideoPosting } from '../_lib/postVideo.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { videoId, conceptId, platforms, postDetailsOverride } = req.body;

  if (!videoId || !conceptId || !platforms) {
    return res.status(400).json({ error: 'Missing videoId, conceptId, or platforms in request body.' });
  }

  try {
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON environment variable is not set.');
    }

    const results = await performVideoPosting({
      conceptId,
      serviceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON!,
      targetVideoId: videoId,
      targetPlatforms: platforms,
      postDetailsOverride,
    });

    res.status(200).json({ message: 'Posting process completed.', results });
  } catch (error: any) {
    console.error('Manual posting API failed:', error);
    res.status(500).json({ error: error.message || 'Failed to initiate posting process.' });
  }
}
