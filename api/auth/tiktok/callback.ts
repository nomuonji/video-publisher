
import type { VercelRequest, VercelResponse } from '@vercel/node';
import fetch from 'node-fetch';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { code } = req.query;

  if (!code || typeof code !== 'string') {
    return res.status(400).send('Authorization code is missing');
  }

  const tokenEndpoint = 'https://open.tiktokapis.com/v2/oauth/token/';
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  const redirectUri = `https://video-publisher.vercel.app/api/auth/tiktok/callback`;

  const params = new URLSearchParams();
  params.append('client_key', clientKey!);
  params.append('client_secret', clientSecret!);
  params.append('code', code);
  params.append('grant_type', 'authorization_code');
  params.append('redirect_uri', redirectUri);

  try {
    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    // TODO: Store the access_token, refresh_token, etc. securely
    res.status(200).json(data);

  } catch (error) {
    console.error('Error exchanging code for access token:', error);
    res.status(500).send('Internal Server Error');
  }
}
