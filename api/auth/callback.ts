import type { VercelRequest, VercelResponse } from '@vercel/node';
import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import type { ConceptConfig } from '../../types.js';
import { withNormalizedPostingTimes } from '../../utils/schedule.js';

// --- OAuth Client for User ---
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

// --- Main Handler ---
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
      return res.status(400).send('Concept ID not found in state.');
    }
    if (!accessToken) {
      return res.status(400).send('Google Access Token not found in state.');
    }

    // 1. Exchange code for refresh token (using the client for YouTube auth)
    const youtubeOAuth2Client = getOAuth2Client(req);
    const { tokens } = await youtubeOAuth2Client.getToken(code);
    const refreshToken = tokens.refresh_token;

    if (!refreshToken) {
      throw new Error('Refresh token not granted. Please ensure you are providing consent.');
    }

    youtubeOAuth2Client.setCredentials({
        refresh_token: refreshToken,
        access_token: tokens.access_token || undefined,
    });

    // 2. Use user's Google token (from state) to update config.json on Google Drive
    const driveOAuth2Client = new google.auth.OAuth2();
    driveOAuth2Client.setCredentials({ access_token: accessToken });
    const drive = google.drive({ version: 'v3', auth: driveOAuth2Client });

    // Find the config.json file for the concept
    const fileRes = await drive.files.list({
        q: `'${conceptId}' in parents and name='config.json' and trashed=false`,
        fields: 'files(id)',
        pageSize: 1,
    });
    const configFile = fileRes.data.files?.[0];
    if (!configFile || !configFile.id) {
        throw new Error(`config.json not found for concept ${conceptId}`);
    }

    // Get current config content
    const contentRes = await drive.files.get({ fileId: configFile.id, alt: 'media' }, { responseType: 'json' });
    const currentConfig = withNormalizedPostingTimes(contentRes.data as ConceptConfig);

    let youtubeChannelId = currentConfig?.apiKeys?.youtube_channel_id || '';
    let youtubeChannelName = currentConfig?.apiKeys?.youtube_channel_name || '';

    try {
        const youtube = google.youtube({ version: 'v3', auth: youtubeOAuth2Client });
        const channelRes = await youtube.channels.list({
            part: ['snippet'],
            mine: true,
        });
        const channel = channelRes.data.items?.[0];
        if (channel) {
            youtubeChannelId = channel.id || youtubeChannelId;
            youtubeChannelName = channel.snippet?.title || youtubeChannelName;
        }
    } catch (channelError) {
        console.error('Failed to fetch YouTube channel info:', channelError);
    }

    // Update config with the new refresh token
    const newConfig: ConceptConfig = {
        ...currentConfig,
        apiKeys: {
            ...currentConfig.apiKeys,
            youtube_refresh_token: refreshToken,
            youtube_channel_id: youtubeChannelId,
            youtube_channel_name: youtubeChannelName,
        }
    };
    const normalizedConfig = withNormalizedPostingTimes(newConfig);

    // Upload the updated config.json
    await drive.files.update({
        fileId: configFile.id,
        media: {
            mimeType: 'application/json',
            body: JSON.stringify(normalizedConfig, null, 2),
        },
    });

    // 3. Return a script to the popup that messages the parent window and closes itself
    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(`
      <!DOCTYPE html>
      <html>
        <head><title>Authentication Success</title></head>
        <body>
          <script>
            window.opener.postMessage({ status: 'success', service: 'youtube' }, '*');
            window.close();
          </script>
          <p>Authentication successful! You can now close this window.</p>
        </body>
      </html>
    `);

  } catch (error: any) {
    console.error('Callback handler failed:', error);
    // Return a script that posts an error message
    res.setHeader('Content-Type', 'text/html');
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
        <head><title>Authentication Failed</title></head>
        <body>
          <script>
            window.opener.postMessage({ status: 'error', service: 'youtube', message: '${error.message}' }, '*');
            window.close();
          </script>
          <p>Authentication failed. Please try again. You can close this window.</p>
        </body>
      </html>
    `);
  }
}