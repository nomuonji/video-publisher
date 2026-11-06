// Upload videos committed under incoming/<concept>/ to Drive v-stock/<concept>/queue,
// together with their sidecar JSON (title, description, hashtags, aiLabel), and
// optionally post them right away.
//
//   incoming/おもしろ/2026-11-06-atatame.mp4
//   incoming/おもしろ/2026-11-06-atatame.json   {"title": "...", "description": "...", "hashtags": "#a #b", "postNow": true}
//
// Producers in other repos (e.g. nomuonji/animation-factory) push such files on an
// `incoming/<anything>` branch; workflow "Queue From Repo" runs this script and then
// deletes the branch, so videos never land on main.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { Readable } from 'node:stream';
import { performVideoPosting } from '../api/_lib/postVideo.js';
import { infoLog, errorLog } from '../utils/logger.js';

async function findFolder(drive: any, name: string, parent?: string): Promise<string | null> {
  const q = [`mimeType='application/vnd.google-apps.folder'`, `name='${name.replace(/'/g, "\\'")}'`, 'trashed=false'];
  if (parent) q.push(`'${parent}' in parents`);
  const res = await drive.files.list({ q: q.join(' and '), fields: 'files(id)', pageSize: 1, supportsAllDrives: true, includeItemsFromAllDrives: true });
  return res.data.files?.[0]?.id || null;
}

async function exists(drive: any, folder: string, name: string) {
  const res = await drive.files.list({ q: `'${folder}' in parents and name='${name.replace(/'/g, "\\'")}' and trashed=false`, fields: 'files(id)', pageSize: 1 });
  return res.data.files?.[0]?.id || null;
}

async function main() {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!json) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is required.');
  const key = JSON.parse(json);
  const auth = new JWT({ email: key.client_email, key: key.private_key, scopes: ['https://www.googleapis.com/auth/drive'] });
  const drive = google.drive({ version: 'v3', auth });
  const root = await findFolder(drive, 'v-stock');
  if (!root) throw new Error("'v-stock' folder not found.");

  const base = 'incoming';
  if (!fs.existsSync(base)) { infoLog('No incoming/ folder.'); return; }
  let failures = 0, done = 0;
  for (const concept of fs.readdirSync(base)) {
    const dir = path.join(base, concept);
    if (!fs.statSync(dir).isDirectory()) continue;
    const conceptId = await findFolder(drive, concept, root);
    if (!conceptId) { errorLog(`Concept folder '${concept}' not found under v-stock.`); failures++; continue; }
    const queue = await findFolder(drive, 'queue', conceptId);
    if (!queue) { errorLog(`${concept}/queue not found.`); failures++; continue; }
    for (const file of fs.readdirSync(dir).filter((f) => /\.(mp4|mov)$/i.test(f))) {
      if (!/^[A-Za-z0-9._-]+$/.test(file)) { errorLog(`Unsafe file name: ${file}`); failures++; continue; }
      const sidecarPath = path.join(dir, file.replace(/\.[^.]+$/, '.json'));
      const meta = fs.existsSync(sidecarPath) ? JSON.parse(fs.readFileSync(sidecarPath, 'utf8')) : {};
      if (await exists(drive, queue, file)) { errorLog(`${concept}/queue/${file} already exists; skipped.`); failures++; continue; }
      const { postNow, ...sidecar } = meta;
      if (Object.keys(sidecar).length) {
        await drive.files.create({
          requestBody: { name: path.basename(sidecarPath), parents: [queue], mimeType: 'application/json' },
          media: { mimeType: 'application/json', body: Readable.from([JSON.stringify(sidecar, null, 2)]) },
          fields: 'id',
        });
      }
      const up = await drive.files.create({
        requestBody: { name: file, parents: [queue] },
        media: { mimeType: 'video/mp4', body: fs.createReadStream(path.join(dir, file)) },
        fields: 'id',
      });
      infoLog(`Queued ${concept}/queue/${file} (${up.data.id})`);
      if (postNow) {
        const platforms = typeof postNow === 'string' ? Object.fromEntries(postNow.split(',').map((p: string) => [p.trim(), true])) : { YouTube: true };
        const results = await performVideoPosting({ conceptId, serviceAccountJson: json, targetVideoId: up.data.id!, targetPlatforms: platforms as any });
        infoLog('Results:', JSON.stringify(results, null, 2));
        if (!Object.values(results).some((r: any) => r?.success)) { errorLog(`Posting ${file} failed.`); failures++; continue; }
      }
      done++;
    }
  }
  if (failures) throw new Error(`${failures} item(s) failed, ${done} done.`);
  if (!done) throw new Error('Nothing was queued.');
}

main().catch((e) => {
  errorLog('queue-from-repo failed:', e);
  process.exit(1);
});
