
import type { VercelRequest, VercelResponse } from '@vercel/node';
import fetch from 'node-fetch';

console.log('Instagram callback module initializing…');

import { google } from 'googleapis';

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

const GRAPH_API_URL = 'https://graph.facebook.com/v19.0';

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
      throw new Error('Concept ID not found in state.');
    }
    if (!accessToken) {
      throw new Error('Google Access Token not found in state.');
    }

    // Step 1: Exchange Instagram code for an Instagram token
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const redirectUri = `${proto}://${host}/api/auth/instagram/callback`;

    const tokenUrl = `${GRAPH_API_URL}/oauth/access_token`;
    const tokenParams = new URLSearchParams({
        client_id: process.env.INSTAGRAM_APP_ID!,
        client_secret: process.env.INSTAGRAM_APP_SECRET!,
        redirect_uri: redirectUri,
        code: code,
    });
    const tokenRes = await fetch(`${tokenUrl}?${tokenParams.toString()}`);
    const shortLivedTokenData = await tokenRes.json();
    if (!tokenRes.ok) {
        throw new Error(`Failed to get short-lived token: ${shortLivedTokenData.error?.message || 'Unknown error'}`);
    }
    const shortLivedToken = shortLivedTokenData.access_token;

    const longLivedTokenUrl = `${GRAPH_API_URL}/oauth/access_token`;
    const longLivedTokenParams = new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: process.env.INSTAGRAM_APP_ID!,
        client_secret: process.env.INSTAGRAM_APP_SECRET!,
        fb_exchange_token: shortLivedToken,
    });
    const longLivedTokenRes = await fetch(`${longLivedTokenUrl}?${longLivedTokenParams.toString()}`);
    const longLivedTokenData = await longLivedTokenRes.json();
    if (!longLivedTokenRes.ok) {
        throw new Error(`Failed to get long-lived token: ${longLivedTokenData.error?.message || 'Unknown error'}`);
    }
    const longLivedToken = longLivedTokenData.access_token;

    // Step 2: Get the user's linked Instagram accounts
    const pagesUrl = `${GRAPH_API_URL}/me/accounts`;
    const pagesParams = new URLSearchParams({
        access_token: longLivedToken,
        fields: 'id,name,access_token,instagram_business_account{id,name,username}',
    });
    const pagesRes = await fetch(`${pagesUrl}?${pagesParams.toString()}`);
    const pagesData = await pagesRes.json();
    if (!pagesRes.ok) {
        throw new Error(`Failed to get pages: ${pagesData.error?.message || 'Unknown error'}`);
    }
    const linkedAccounts = pagesData.data
        .filter((page: any) => page.instagram_business_account)
        .map((page: any) => ({
            id: page.instagram_business_account.id,
            name: page.instagram_business_account.name,
            username: page.instagram_business_account.username,
            page_id: page.id,
            page_name: page.name,
            page_access_token: page.access_token,
        }));

    if (linkedAccounts.length === 0) {
        throw new Error('No Instagram Business Account linked to any of your Facebook Pages was found.');
    }

    // Step 3: Save the linked accounts to Google Drive using the user's token
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    // Find the root 'v-stock' folder.
    const vStockRes = await drive.files.list({
        q: `mimeType='application/vnd.google-apps.folder' and name='v-stock' and trashed=false`,
        fields: 'files(id)',
        pageSize: 1,
    });

    if (!vStockRes.data.files || vStockRes.data.files.length === 0) {
        throw new Error('The root \'v-stock\' folder was not found in your Google Drive.');
    }
    const parentFolderId = vStockRes.data.files[0].id!;

    // Find the instagram_accounts.json file.
    const fileRes = await drive.files.list({
        q: `'${parentFolderId}' in parents and name='instagram_accounts.json' and trashed=false`,
        fields: 'files(id)',
        pageSize: 1,
    });

    // If an old file exists (especially one created by the Service Account), delete it.
    if (fileRes.data.files && fileRes.data.files.length > 0) {
        const oldFileId = fileRes.data.files[0].id!;
        try {
            await drive.files.delete({ fileId: oldFileId });
        } catch (e) {
            // Log error but continue, as creating a new file is the main goal.
            console.error(`Could not delete old instagram_accounts.json file (ID: ${oldFileId}), proceeding to create a new one. Error:`, e);
        }
    }

    // Always create a new file to ensure correct ownership by the user.
    const fileMetadata = {
        name: 'instagram_accounts.json',
        parents: [parentFolderId],
    };
    const media = {
        mimeType: 'application/json',
        body: JSON.stringify(linkedAccounts, null, 2),
    };
    await drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: 'id', // Requesting fields is good practice
    });

    // Step 4: Signal success to the frontend
    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(renderResponseScript('success', 'instagram'));

  } catch (error: any) {
    console.error('Instagram callback handler failed:', error);
    if (error && error.stack) {
      console.error('Instagram callback handler stack:', error.stack);
    }
    res.setHeader('Content-Type', 'text/html');
    res.status(500).send(renderResponseScript('error', 'instagram', error.message));
  }
}
