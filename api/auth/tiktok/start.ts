
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  const clientId = process.env.TIKTOK_CLIENT_KEY;
  // TODO: Add the correct redirect URI
  const redirectUri = `https://video-publisher.vercel.app/api/auth/tiktok/callback`;
  // TODO: Add the correct scopes
  const scope = 'user.info.basic,video.upload';
  const responseType = 'code';
  // TODO: Find the correct authorization URL
  const url = `https://www.tiktok.com/v2/auth/authorize?client_key=${clientId}&scope=${scope}&response_type=${responseType}&redirect_uri=${redirectUri}`;

  res.redirect(url);
}
