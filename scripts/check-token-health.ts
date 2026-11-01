/**
 * Daily health check for YouTube refresh tokens.
 *
 * Walks every concept folder under `v-stock` on Google Drive and, for each
 * concept that has a `youtube_refresh_token`, exchanges it for a fresh access
 * token. This does two things:
 *
 *   1. Keeps the token in active use, so Google does not revoke it for
 *      inactivity (refresh tokens unused for 6 months are invalidated).
 *   2. Fails loudly the day a token stops working, instead of discovering it
 *      when a scheduled post fails.
 *
 * Read-only: no config.json is modified and no video is posted.
 *
 * Exits non-zero when any concept's token is dead, so the GitHub Actions run
 * turns red.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

const REQUIRED = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_SERVICE_ACCOUNT_JSON'];
for (const key of REQUIRED) {
  if (!process.env[key]) {
    console.error(`Missing env var: ${key}`);
    process.exit(1);
  }
}

const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!);
const driveAuth = new JWT({
  email: serviceAccount.client_email,
  key: serviceAccount.private_key,
  scopes: ['https://www.googleapis.com/auth/drive'],
});
const drive = google.drive({ version: 'v3', auth: driveAuth });

async function listFolders(query: string) {
  const res = await drive.files.list({
    q: query,
    fields: 'files(id,name)',
    pageSize: 200,
  });
  return res.data.files || [];
}

async function readConfigJson(folderId: string) {
  const files = await listFolders(`'${folderId}' in parents and name='config.json' and trashed=false`);
  if (!files[0]?.id) return null;
  const res = await drive.files.get({ fileId: files[0].id, alt: 'media' });
  return typeof res.data === 'string' ? JSON.parse(res.data) : (res.data as any);
}

async function main() {
  const vStock = (await listFolders(
    "mimeType='application/vnd.google-apps.folder' and name='v-stock' and trashed=false",
  ))[0];
  if (!vStock?.id) {
    console.error("'v-stock' folder not found");
    process.exit(1);
  }

  const concepts = await listFolders(
    `'${vStock.id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  );
  concepts.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ja'));

  const failures: string[] = [];
  let checked = 0;

  for (const concept of concepts) {
    const name = concept.name || '(unnamed)';
    let config: any;
    try {
      config = await readConfigJson(concept.id!);
    } catch (error: any) {
      console.log(`- ${name}: config.json の読み取りに失敗 (${error?.message})`);
      failures.push(name);
      continue;
    }

    if (!config) {
      console.log(`- ${name}: skip (config.json なし)`);
      continue;
    }

    const refreshToken = config.apiKeys?.youtube_refresh_token;
    if (!refreshToken) {
      console.log(`- ${name}: skip (YouTube 未認証)`);
      continue;
    }

    checked += 1;
    const oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
    );
    oauth2.setCredentials({ refresh_token: refreshToken });

    try {
      await oauth2.refreshAccessToken();

      let detail = '';
      try {
        const youtube = google.youtube({ version: 'v3', auth: oauth2 });
        const channel = (await youtube.channels.list({ part: ['snippet'], mine: true })).data.items?.[0];
        detail = channel ? ` / ${channel.snippet?.title} (${channel.id})` : '';
      } catch {
        detail = ' / チャンネル情報は取得できず（トークン自体は有効）';
      }

      const youtubeEnabled = config.platforms?.YouTube === true;
      const times = Array.isArray(config.postingTimes) ? config.postingTimes.length : 0;
      const notes = [
        youtubeEnabled ? null : 'platforms.YouTube=false',
        times === 0 ? 'postingTimes 未設定' : null,
      ].filter(Boolean);
      const note = notes.length > 0 ? `  [投稿対象外: ${notes.join(', ')}]` : '';

      console.log(`- ${name}: OK${detail}${note}`);
    } catch (error: any) {
      const message = String(error?.message || error).slice(0, 200);
      console.log(`- ${name}: NG (${message})`);
      failures.push(name);
    }
  }

  console.log('\n--- Summary ---');
  console.log(`トークンを確認したコンセプト数: ${checked}`);
  if (failures.length > 0) {
    console.error(`失効しているトークン: ${failures.join(', ')}`);
    console.error('再認証: npx tsx scripts/reauth-youtube.ts <コンセプト名の前方一致> [port]');
    process.exit(1);
  }
  console.log('すべての YouTube トークンは有効です。');
}

main().catch((error) => {
  console.error('Health check failed:', error?.message || error);
  process.exit(1);
});
