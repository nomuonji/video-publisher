// Post videos committed under incoming/<concept>/ straight to the concept's YouTube
// channel, using that concept's refresh token from Drive v-stock/<concept>/config.json.
//
//   incoming/おもしろ/2026-11-06-atatame.mp4
//   incoming/おもしろ/2026-11-06-atatame.json   {"title": "...", "description": "...", "hashtags": "#a #b", "aiLabel": false}
//
// Why direct: the service account can READ Drive but cannot create files there
// ("Service Accounts do not have storage quota"), so dropping into queue/ from CI is
// impossible without a shared drive. Producers (e.g. nomuonji/animation-factory) push such
// files on an `incoming/<anything>` branch; workflow "Queue From Repo" runs this and then
// deletes the branch, so videos never land on main. Results go to the job summary.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { infoLog, errorLog } from '../utils/logger.js';

const AI_LABEL_MESSAGE = 'This video includes altered or synthetic content.';

async function findFolder(drive: any, name: string, parent?: string): Promise<string | null> {
  const q = [`mimeType='application/vnd.google-apps.folder'`, `name='${name.replace(/'/g, "\\'")}'`, 'trashed=false'];
  if (parent) q.push(`'${parent}' in parents`);
  const res = await drive.files.list({ q: q.join(' and '), fields: 'files(id)', pageSize: 1 });
  return res.data.files?.[0]?.id || null;
}

async function readConfig(drive: any, conceptId: string) {
  const res = await drive.files.list({ q: `'${conceptId}' in parents and name='config.json' and trashed=false`, fields: 'files(id)', pageSize: 1 });
  const id = res.data.files?.[0]?.id;
  if (!id) throw new Error('config.json not found');
  const got = await drive.files.get({ fileId: id, alt: 'media' }, { responseType: 'text' });
  return typeof got.data === 'string' ? JSON.parse(got.data) : got.data;
}

async function main() {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!json || !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET are required.');
  const key = JSON.parse(json);
  const auth = new JWT({ email: key.client_email, key: key.private_key, scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
  const drive = google.drive({ version: 'v3', auth });
  const root = await findFolder(drive, 'v-stock');
  if (!root) throw new Error("'v-stock' folder not found.");

  const base = 'incoming';
  if (!fs.existsSync(base)) throw new Error('No incoming/ folder.');
  const summary: string[] = ['| concept | file | result |', '|---|---|---|'];
  let failures = 0, done = 0;
  for (const concept of fs.readdirSync(base)) {
    const dir = path.join(base, concept);
    if (!fs.statSync(dir).isDirectory()) continue;
    const conceptId = await findFolder(drive, concept, root);
    if (!conceptId) { errorLog(`Concept folder '${concept}' not found under v-stock.`); failures++; continue; }
    const config = await readConfig(drive, conceptId);
    const refresh = config?.apiKeys?.youtube_refresh_token;
    if (!refresh) { errorLog(`${concept}: no youtube_refresh_token in config.json`); failures++; continue; }
    const oauth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
    oauth.setCredentials({ refresh_token: refresh });
    const youtube = google.youtube({ version: 'v3', auth: oauth });
    for (const file of fs.readdirSync(dir).filter((f) => /\.(mp4|mov)$/i.test(f))) {
      if (!/^[A-Za-z0-9._-]+$/.test(file)) { errorLog(`Unsafe file name: ${file}`); failures++; continue; }
      const sidecarPath = path.join(dir, file.replace(/\.[^.]+$/, '.json'));
      const meta = { ...(config.postDetails ?? {}), ...(fs.existsSync(sidecarPath) ? JSON.parse(fs.readFileSync(sidecarPath, 'utf8')) : {}) };
      if (!meta.title) { errorLog(`${file}: no title`); failures++; continue; }
      const hashtags: string = meta.hashtags ?? '';
      let description: string = meta.description ?? '';
      if (meta.aiLabel && !description.includes(AI_LABEL_MESSAGE)) description = `${description.trim()}\n\n${AI_LABEL_MESSAGE}`;
      try {
        const res = await youtube.videos.insert({
          part: ['snippet', 'status'],
          requestBody: {
            snippet: {
              title: meta.title,
              description: hashtags ? `${description}\n\n${hashtags}` : description,
              tags: hashtags.split(/\s+/).filter((t) => t.startsWith('#')).map((t) => t.slice(1)),
            },
            status: {
              privacyStatus: meta.privacy ?? 'public',
              madeForKids: false,
              selfDeclaredMadeForKids: false,
              ...(meta.aiLabel ? { aiGeneratedContent: true } : {}),
            } as any,
          },
          media: { mimeType: 'video/mp4', body: fs.createReadStream(path.join(dir, file)) },
        });
        const id = (res as any).data?.id;
        infoLog(`Posted ${concept}/${file} → https://youtube.com/shorts/${id}`);
        summary.push(`| ${concept} | ${file} | https://youtube.com/shorts/${id} |`);
        done++;
      } catch (e: any) {
        errorLog(`Posting ${file} failed:`, e?.message ?? e);
        summary.push(`| ${concept} | ${file} | FAILED: ${String(e?.message ?? e).slice(0, 120)} |`);
        failures++;
      }
    }
  }
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join('\n') + '\n');
  if (failures) throw new Error(`${failures} item(s) failed, ${done} posted.`);
  if (!done) throw new Error('Nothing was posted.');
}

main().catch((e) => {
  errorLog('queue-from-repo failed:', e?.message ?? e);
  process.exit(1);
});
