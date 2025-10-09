import type { VercelRequest, VercelResponse } from '@vercel/node';
import fetch from 'node-fetch';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

// --- Service Account Client for Drive ---
const getServiceAccountAuth = () => {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set.');
  }
  const serviceAccountKey = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new JWT({
    email: serviceAccountKey.client_email,
    key: serviceAccountKey.private_key,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
};

const renderResponseScript = (status: 'success' | 'error', service: string, message?: string) => `
  <!DOCTYPE html>
  <html>
    <head><title>Authentication ${status === 'success' ? 'Success' : 'Failed'}</title></head>
    <body>
      <script>
        window.opener.postMessage({ status: '${status}', service: '${service}', message: '${message || ''}' }, '*');
        window.close();
      </script>
      <p>Authentication ${status}! You can now close this window.</p>
    </body>
  </html>
`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { code, state } = req.query;

  if (!code || typeof code !== 'string') {
    return res.status(400).send('Authorization code is missing.');
  }
  if (!state || typeof state !== 'string') {
    return res.status(400).send('State is missing.');
  }

  let conceptId: string;
  try {
    conceptId = JSON.parse(state).conceptId;
    if (!conceptId) {
      throw new Error('Concept ID not found in state.');
    }
  } catch (error) {
    return res.status(400).send('Invalid state format.');
  }

  try {
    // 1. Exchange code for TikTok access token
    const tokenEndpoint = 'https://open.tiktokapis.com/v2/oauth/token/';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const redirectUri = `${proto}://${host}/api/auth/tiktok/callback`;

    const params = new URLSearchParams();
    params.append('client_key', process.env.TIKTOK_CLIENT_KEY!);
    params.append('client_secret', process.env.TIKTOK_CLIENT_SECRET!);
    params.append('code', code);
    params.append('grant_type', 'authorization_code');
    params.append('redirect_uri', redirectUri);

    const tokenResponse = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const tiktokTokens = await tokenResponse.json();
    if (!tokenResponse.ok) {
      throw new Error(`TikTok token exchange failed: ${tiktokTokens.error_description || 'Unknown error'}`);
    }

    // 2. Use service account to update config.json on Google Drive
    const serviceAuth = getServiceAccountAuth();
    const drive = google.drive({ version: 'v3', auth: serviceAuth });

    const fileRes = await drive.files.list({
        q: `'${conceptId}' in parents and name='config.json' and trashed=false`,
        fields: 'files(id)',
        pageSize: 1,
    });

    const configFile = fileRes.data.files?.[0];
    if (!configFile || !configFile.id) {
        throw new Error(`config.json not found for concept ${conceptId}`);
    }

    const contentRes = await drive.files.get({ fileId: configFile.id, alt: 'media' });
    const currentConfig = contentRes.data as any; // Cast to any to avoid type issues with dynamic config

    // Update config with the new TikTok tokens
    const newConfig = {
        ...currentConfig,
        apiKeys: {
            ...currentConfig.apiKeys,
            tiktok: JSON.stringify(tiktokTokens), // Store the full token object as a string
        }
    };

    await drive.files.update({
        fileId: configFile.id,
        media: {
            mimeType: 'application/json',
            body: JSON.stringify(newConfig, null, 2),
        },
    });

    // 3. Return success script to the popup
    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(renderResponseScript('success', 'tiktok'));

  } catch (error: any) {
    console.error('TikTok callback handler failed:', error);
    res.setHeader('Content-Type', 'text/html');
    res.status(500).send(renderResponseScript('error', 'tiktok', error.message));
  }
}