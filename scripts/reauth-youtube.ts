/**
 * Re-authorize YouTube for one concept WITHOUT Vercel.
 *
 * Starts a local loopback server, you approve in your browser, and the new
 * refresh token is written into that concept's config.json on Google Drive
 * (using the service account, same as the GitHub Actions poster).
 *
 * Usage:
 *   npx tsx scripts/reauth-youtube.ts <concept-name-prefix> [port]
 *   e.g. npx tsx scripts/reauth-youtube.ts おも 53682
 *
 * Required in .env.local (or the environment):
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_SERVICE_ACCOUNT_JSON
 *
 * One-time setup: add  http://localhost:<port>/oauth2callback  to
 * "Authorized redirect URIs" of the OAuth client in Google Cloud Console.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

const prefix = process.argv[2];
const port = Number(process.argv[3] || 53682);
if (!prefix) {
  console.error('Usage: npx tsx scripts/reauth-youtube.ts <concept-name-prefix> [port]');
  process.exit(1);
}

for (const k of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_SERVICE_ACCOUNT_JSON']) {
  if (!process.env[k]) {
    console.error(`Missing env var: ${k} (set it in .env.local)`);
    process.exit(1);
  }
}

const redirectUri = `http://localhost:${port}/oauth2callback`;
const oauth2 = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  redirectUri,
);

const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!);
const saAuth = new JWT({
  email: sa.client_email,
  key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/drive'],
});
const drive = google.drive({ version: 'v3', auth: saAuth });

async function list(q: string, fields: string) {
  const res = await drive.files.list({ q, fields, pageSize: 100 });
  return res.data.files || [];
}

async function findTarget() {
  const v = (await list(`mimeType='application/vnd.google-apps.folder' and name='v-stock' and trashed=false`, 'files(id)'))[0];
  if (!v) throw new Error("'v-stock' folder not found");
  const folders = (await list(`'${v.id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`, 'files(id,name)'))
    .filter(f => (f.name || '').startsWith(prefix));
  if (folders.length === 0) throw new Error(`No concept folder starts with "${prefix}"`);
  if (folders.length > 1) throw new Error(`Prefix "${prefix}" is ambiguous: ${folders.map(f => f.name).join(', ')}`);
  const folder = folders[0];
  const cf = (await list(`'${folder.id}' in parents and name='config.json' and trashed=false`, 'files(id)'))[0];
  if (!cf) throw new Error(`config.json not found in "${folder.name}"`);
  return { folderName: folder.name!, configFileId: cf.id! };
}

function waitForCode(state: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${port}`);
      if (url.pathname !== '/oauth2callback') {
        res.writeHead(404).end();
        return;
      }
      const err = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      const gotState = url.searchParams.get('state');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      if (err || !code || gotState !== state) {
        res.writeHead(400).end('<p>Authorization failed. You can close this tab and check the terminal.</p>');
        server.close();
        reject(new Error(err ? `Google returned error: ${err}` : 'Missing code or state mismatch'));
        return;
      }
      res.writeHead(200).end('<p>Authorization received. You can close this tab and return to the terminal.</p>');
      server.close();
      resolve(code);
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1');
    setTimeout(() => { server.close(); reject(new Error('Timed out waiting for authorization (5 min)')); }, 5 * 60 * 1000);
  });
}

async function main() {
  const target = await findTarget();
  console.log(`Target concept: ${target.folderName}`);

  const state = crypto.randomBytes(16).toString('hex');
  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent select_account',
    scope: ['https://www.googleapis.com/auth/youtube'],
    state,
  });
  console.log('\nOpen this URL in your browser and approve with the YouTube channel account:\n');
  console.log(authUrl + '\n');

  const code = await waitForCode(state);
  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error('No refresh token returned. Revoke the app at https://myaccount.google.com/permissions and retry.');
  }
  oauth2.setCredentials(tokens);

  let channelId = '';
  let channelName = '';
  try {
    const yt = google.youtube({ version: 'v3', auth: oauth2 });
    const ch = (await yt.channels.list({ part: ['snippet'], mine: true })).data.items?.[0];
    channelId = ch?.id || '';
    channelName = ch?.snippet?.title || '';
    console.log(`Authorized channel: ${channelName} (${channelId})`);
  } catch (e: any) {
    console.warn('Could not read channel info (continuing):', e?.message);
  }

  const current: any = (await drive.files.get({ fileId: target.configFileId, alt: 'media' })).data;
  const backupPath = `config-backup-${Date.now()}.json`;
  fs.writeFileSync(backupPath, JSON.stringify(current, null, 2), { mode: 0o600 });
  console.log(`Backed up old config.json to ./${backupPath} (contains tokens; delete when done)`);

  const next = {
    ...current,
    apiKeys: {
      ...current.apiKeys,
      youtube_refresh_token: tokens.refresh_token,
      youtube_channel_id: channelId || current.apiKeys?.youtube_channel_id || '',
      youtube_channel_name: channelName || current.apiKeys?.youtube_channel_name || '',
    },
  };
  await drive.files.update({
    fileId: target.configFileId,
    media: { mimeType: 'application/json', body: JSON.stringify(next, null, 2) },
  });
  console.log('Updated config.json on Drive.');

  // Verify what was actually stored works.
  const check: any = (await drive.files.get({ fileId: target.configFileId, alt: 'media' })).data;
  const verify = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  verify.setCredentials({ refresh_token: check.apiKeys.youtube_refresh_token });
  const { credentials } = await verify.refreshAccessToken();
  console.log(credentials.access_token ? 'OK: stored refresh token works.' : 'NG: stored token did not refresh.');
}

main().catch(e => { console.error('Failed:', e?.message || e); process.exit(1); });
