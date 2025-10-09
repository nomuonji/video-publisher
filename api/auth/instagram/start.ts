
import type { VercelRequest, VercelResponse } from '@vercel/node';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

export default function handler(req: VercelRequest, res: VercelResponse) {
  const { conceptId, accessToken } = req.query;

  if (!conceptId || typeof conceptId !== 'string') {
    return res.status(400).send('Concept ID is required.');
  }
  if (!accessToken || typeof accessToken !== 'string') {
    return res.status(400).send('Google Access Token is required.');
  }

  const clientId = process.env.INSTAGRAM_APP_ID;

  if (!clientId) {
    return res.status(500).send('Server configuration error: INSTAGRAM_APP_ID is not set.');
  }

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const redirectUri = `${proto}://${host}/api/auth/instagram/callback`;
  
  const scopes = [
    'instagram_basic',
    'instagram_content_publish',
    'pages_show_list',
    'pages_read_engagement',
    'business_management' // Added this essential scope
  ].join(',');

  const state = JSON.stringify({ conceptId, accessToken });

  const authUrl = `https://www.facebook.com/v19.0/dialog/oauth?` + 
    `client_id=${clientId}` + 
    `&redirect_uri=${encodeURIComponent(redirectUri)}` + 
    `&scope=${encodeURIComponent(scopes)}` + 
    `&response_type=code` + 
    `&state=${encodeURIComponent(state)}`;

  res.redirect(302, authUrl);
}
