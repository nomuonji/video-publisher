
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  const { conceptId } = req.query;

  if (!conceptId || typeof conceptId !== 'string') {
    return res.status(400).send('Concept ID is required.');
  }

  const clientId = process.env.TIKTOK_CLIENT_KEY;
  // This should be the production URL, or dynamically determined.
  const redirectUri = `https://video-publisher.vercel.app/api/auth/tiktok/callback`;
  const scope = 'user.info.basic,video.upload,video.publish'; // Added video.publish
  const responseType = 'code';
  
  // Use a JSON string for the state to pass multiple values if needed
  const state = JSON.stringify({ conceptId });

  const url = `https://www.tiktok.com/v2/auth/authorize?client_key=${clientId}&scope=${scope}&response_type=${responseType}&redirect_uri=${redirectUri}&state=${encodeURIComponent(state)}`;

  res.redirect(url);
}
