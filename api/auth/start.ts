import type { VercelRequest, VercelResponse } from '@vercel/node';
import { OAuth2Client } from 'google-auth-library';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

const getOAuth2Client = (req: VercelRequest) => {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const redirectUri = `${proto}://${host}/api/auth/callback`;

  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );
};

export default function handler(req: VercelRequest, res: VercelResponse) {
  const { conceptId, accessToken } = req.query;

  if (!conceptId || typeof conceptId !== 'string') {
    return res.status(400).send('Concept ID is required.');
  }
  if (!accessToken || typeof accessToken !== 'string') {
    return res.status(400).send('Google Access Token is required.');
  }

  const oauth2Client = getOAuth2Client(req);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent select_account',
    scope: [
      'https://www.googleapis.com/auth/youtube',
      'https://www.googleapis.com/auth/drive.readonly' // Scope for reading config
    ],
    state: JSON.stringify({ conceptId, accessToken }), // Pass conceptId and accessToken through the state
  });

  res.redirect(302, authUrl);
}
