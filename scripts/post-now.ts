// Post one video right now, outside the schedule.
//
//   CONCEPT_NAME=ちんすけ VIDEO_NAME=001-selfregi.mp4 npx tsx scripts/post-now.ts
//
// VIDEO_NAME is optional (omit it to post a random video from the queue, same as a
// scheduled run). PLATFORMS=YouTube limits where it goes (comma separated); omitted,
// the concept's own platform settings apply. The schedule state (lastPostedSlot) is
// not touched, so the next scheduled slot still runs as usual.
// Run from GitHub Actions: workflow "Post Now".
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { performVideoPosting } from '../api/_lib/postVideo.js';
import { infoLog, errorLog } from '../utils/logger.js';

async function findFolder(drive: any, name: string, parent?: string): Promise<string | null> {
  const q = [`mimeType='application/vnd.google-apps.folder'`, `name='${name.replace(/'/g, "\\'")}'`, 'trashed=false'];
  if (parent) q.push(`'${parent}' in parents`);
  const res = await drive.files.list({ q: q.join(' and '), fields: 'files(id)', pageSize: 1 });
  return res.data.files?.[0]?.id || null;
}

async function main() {
  const conceptName = process.env.CONCEPT_NAME;
  const videoName = process.env.VIDEO_NAME || '';
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!conceptName || !json) throw new Error('CONCEPT_NAME and GOOGLE_SERVICE_ACCOUNT_JSON are required.');

  const key = JSON.parse(json);
  const auth = new JWT({ email: key.client_email, key: key.private_key, scopes: ['https://www.googleapis.com/auth/drive'] });
  const drive = google.drive({ version: 'v3', auth });

  const root = await findFolder(drive, 'v-stock');
  if (!root) throw new Error("'v-stock' folder not found.");
  const conceptId = await findFolder(drive, conceptName, root);
  if (!conceptId) throw new Error(`Concept folder '${conceptName}' not found under v-stock.`);

  let targetVideoId: string | undefined;
  if (videoName) {
    const queue = await findFolder(drive, 'queue', conceptId);
    if (!queue) throw new Error('queue folder not found.');
    const res = await drive.files.list({
      q: `'${queue}' in parents and name='${videoName.replace(/'/g, "\\'")}' and trashed=false`,
      fields: 'files(id)',
      pageSize: 1,
    });
    targetVideoId = res.data.files?.[0]?.id || undefined;
    if (!targetVideoId) throw new Error(`'${videoName}' is not in ${conceptName}/queue.`);
  }

  const platforms = process.env.PLATFORMS
    ? Object.fromEntries(process.env.PLATFORMS.split(',').map((p) => [p.trim(), true]))
    : undefined;

  const results = await performVideoPosting({ conceptId, serviceAccountJson: json, targetVideoId, targetPlatforms: platforms as any });
  infoLog('Results:', JSON.stringify(results, null, 2));
  if (!Object.values(results).some((r: any) => r?.success)) {
    throw new Error('Nothing was posted.');
  }
}

main().catch((e) => {
  errorLog('post-now failed:', e);
  process.exit(1);
});
