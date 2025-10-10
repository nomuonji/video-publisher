import type { VercelRequest, VercelResponse } from '@vercel/node';
import fetch from 'node-fetch';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import type { TikTokTokens } from '../../../types';

// Load environment variables
dotenv.config({ path: '.env.local' });

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

  try {
    const { conceptId, accessToken } = JSON.parse(state);
    if (!conceptId) {
      throw new Error('Concept ID not found in state.');
    }
    if (!accessToken) {
      throw new Error('Google Access Token not found in state.');
    }

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

    const tiktokTokens = (await tokenResponse.json()) as TikTokTokens & Record<string, any>;
    if (!tokenResponse.ok) {
      throw new Error(`TikTok token exchange failed: ${tiktokTokens.error_description || 'Unknown error'}`);
    }

    let enrichedTikTokTokens: TikTokTokens = { ...tiktokTokens };
    const scopeString = tiktokTokens.scope || '';
    const scopes = scopeString.split(/[ ,]/).map((item: string) => item.trim()).filter(Boolean);
    const hasUserInfoScope = scopes.some((scope: string) =>
      scope.startsWith('user.info') || scope === 'user.info.basic'
    );

    if (tiktokTokens.access_token && hasUserInfoScope) {
      try {
        const userInfoResponse = await fetch(
          'https://open.tiktokapis.com/v2/user/info/?fields=display_name,username,avatar_url',
          {
            headers: {
              Authorization: `Bearer ${tiktokTokens.access_token}`,
            },
          }
        );

        if (userInfoResponse.ok) {
          const userInfo = await userInfoResponse.json();
          const user = userInfo?.data?.user ?? userInfo?.data;
          if (user) {
            enrichedTikTokTokens = {
              ...enrichedTikTokTokens,
              display_name: user.display_name ?? enrichedTikTokTokens.display_name,
              username: user.username ?? enrichedTikTokTokens.username,
              avatar_url: user.avatar_url ?? enrichedTikTokTokens.avatar_url,
            };
          }
        } else {
          const errorBody = await userInfoResponse.text();
          console.error('Failed to fetch TikTok user info:', errorBody);
        }
      } catch (userInfoError) {
        console.error('Error while fetching TikTok user info:', userInfoError);
      }
    } else if (!hasUserInfoScope) {
      console.warn('TikTok token does not include user.info scope; skipping profile enrichment.');
    }

    // 2. Use user's Google token to update config.json on Google Drive
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    const fileRes = await drive.files.list({
        q: `'${conceptId}' in parents and name='config.json' and trashed=false`,
        fields: 'files(id)',
        pageSize: 1,
    });

    const configFile = fileRes.data.files?.[0];
    if (!configFile || !configFile.id) {
        throw new Error(`config.json not found for concept ${conceptId}`);
    }

    // We need to specify responseType: 'json' when getting file content with googleapis
    const contentRes = await drive.files.get({ fileId: configFile.id, alt: 'media' }, { responseType: 'json' });
    const currentConfig = contentRes.data as any;

    // Update config with the new TikTok tokens
    const newConfig = {
        ...currentConfig,
        apiKeys: {
            ...currentConfig.apiKeys,
            tiktok: enrichedTikTokTokens, // Store the full token object with profile info
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
    console.error('TikTok callback handler failed:', error.message);
    if (error.stack) {
        console.error(error.stack);
    }
    res.setHeader('Content-Type', 'text/html');
    res.status(500).send(renderResponseScript('error', 'tiktok', error.message));
  }
}
