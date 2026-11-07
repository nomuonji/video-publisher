// Post videos committed under incoming/<concept>/ straight to the concept's YouTube
// channel, using that concept's refresh token from Drive v-stock/<concept>/config.json.
//
//   incoming/おもしろ/2026-11-06-atatame.mp4
//   incoming/おもしろ/2026-11-06-atatame.json   {"title": "...", "description": "...", "hashtags": "#a #b", "aiLabel": false, "postNow": "YouTube,TikTok", "tiktokAccount": "oyu295"}
//
// postNow picks the platforms ("YouTube", "TikTok", "YouTube,TikTok"); without postNow only YouTube.
// TikTok goes through Buffer when BUFFER_API_KEY is set (see postTikTokViaBuffer), otherwise
// TikTok (fallback): the video is sent through the Content
// Posting API (Direct Post) with the concept's apiKeys.tiktok tokens. Needs the repo secrets
// TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET. The refreshed tokens are written back to
// config.json. Privacy is the most public level the creator allows (an unaudited TikTok app
// only gets SELF_ONLY). A TikTok problem is reported but never fails the job, so the YouTube
// post is not repeated by a re-run.
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

const TT = 'https://open.tiktokapis.com';

/** Platforms named in the sidecar's postNow ("YouTube,TikTok" or an array). No postNow = YouTube only. */
function wants(meta: any, platform: 'youtube' | 'tiktok'): boolean {
  const v = meta.postNow;
  if (v === undefined || v === null || v === '') return platform === 'youtube';
  const list = Array.isArray(v) ? v : String(v).split(',');
  return list.some((x: string) => String(x).trim().toLowerCase() === platform);
}

// --- TikTok through Buffer (preferred when BUFFER_API_KEY is set) ---------------------------
// Buffer's GraphQL API (https://developers.buffer.com) has no upload endpoint: it pulls the video
// from a public, stable HTTPS URL at publish time. The video is therefore attached to one
// long-lived GitHub release of this (public) repository, tag `buffer-media`, and its download URL
// is handed to Buffer. Channel: the sidecar's "tiktokAccount" (TikTok user name as shown in Buffer,
// e.g. "oyu295", or the Buffer channel id), else config.json buffer.tiktokAccount, else the only
// TikTok channel on the account. Mode: sidecar bufferMode (default addToQueue =
// the Buffer posting schedule; "customScheduled" + bufferDueAt for a fixed time).
const BUFFER = 'https://api.buffer.com';

async function buffer(query: string): Promise<any> {
  const r = await fetch(BUFFER, { method: 'POST', headers: { Authorization: `Bearer ${process.env.BUFFER_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || j.errors?.length) throw new Error(`Buffer ${r.status}: ${(j.errors ?? []).map((e: any) => e.message).join('; ') || r.statusText}`);
  return j.data;
}

async function bufferTikTokChannel(account: string | undefined): Promise<{ id: string; name: string }> {
  const acc = await buffer('query { account { organizations { id } } }');
  const all: any[] = [];
  for (const o of acc?.account?.organizations ?? []) {
    const d = await buffer(`query { channels(input: { organizationId: ${JSON.stringify(o.id)} }) { id name displayName service isDisconnected isLocked } }`);
    all.push(...(d?.channels ?? []));
  }
  infoLog(`Buffer channels: ${all.map((c) => `${c.service}:${c.name}${c.displayName && c.displayName !== c.name ? `/${c.displayName}` : ''}(${c.id})`).join(', ') || 'none'}`);
  const norm = (v: unknown) => String(v ?? '').trim().replace(/^@/, '').toLowerCase();
  const tt = all.filter((c) => norm(c.service).includes('tiktok'));
  let pick = tt;
  if (account) pick = tt.filter((c) => [c.id, c.name, c.displayName].some((v) => norm(v) === norm(account)));
  if (pick.length !== 1) throw new Error(account
    ? `TikTok account "${account}" not found in Buffer (TikTok channels: ${tt.map((c) => c.name).join(', ') || 'none'})`
    : `tiktokAccount is not set in the sidecar and Buffer has ${tt.length} TikTok channels`);
  const c = pick[0];
  if (c.isDisconnected || c.isLocked) throw new Error(`Buffer channel ${c.name} is ${c.isDisconnected ? 'disconnected' : 'locked'}`);
  return { id: c.id, name: c.name ?? c.displayName };
}

/** Attach the file to the `buffer-media` release and return its public download URL. */
async function publicVideoUrl(filePath: string, assetName: string): Promise<string> {
  const repo = process.env.GITHUB_REPOSITORY, token = process.env.GITHUB_TOKEN;
  if (!repo || !token) throw new Error('GITHUB_REPOSITORY / GITHUB_TOKEN are needed to host the video for Buffer');
  const gh = (url: string, init: any = {}) => fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', ...(init.headers ?? {}) } });
  let rel: any = await (await gh(`https://api.github.com/repos/${repo}/releases/tags/buffer-media`)).json();
  if (!rel?.id) {
    const cr = await gh(`https://api.github.com/repos/${repo}/releases`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag_name: 'buffer-media', name: 'buffer-media', body: 'Videos handed to Buffer by Queue From Repo (Buffer pulls them from these URLs). Do not delete before they are published.', prerelease: true }) });
    rel = await cr.json();
    if (!rel?.id) throw new Error(`could not create the buffer-media release: ${cr.status} ${rel?.message ?? ''}`);
  }
  const name = assetName.replace(/[^A-Za-z0-9._-]/g, '_');
  const existing = (rel.assets ?? []).find((a: any) => a.name === name);
  if (existing) return existing.browser_download_url;
  const buf = fs.readFileSync(filePath);
  const up = await gh(`https://uploads.github.com/repos/${repo}/releases/${rel.id}/assets?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(buf.length) }, body: buf });
  const a: any = await up.json();
  if (!a?.browser_download_url) throw new Error(`asset upload failed: ${up.status} ${a?.message ?? ''}`);
  return a.browser_download_url;
}

async function postTikTokViaBuffer(filePath: string, assetName: string, caption: string, config: any, meta: any): Promise<string> {
  const ch = await bufferTikTokChannel(meta.tiktokAccount ?? config?.buffer?.tiktokAccount);
  const url = await publicVideoUrl(filePath, assetName);
  const mode = meta.bufferMode === 'customScheduled' ? 'customScheduled' : 'addToQueue';
  const due = mode === 'customScheduled' && meta.bufferDueAt ? ` dueAt: ${JSON.stringify(meta.bufferDueAt)}` : '';
  const ai = meta.aiLabel || meta.isAiGenerated ? ' metadata: { tiktok: { isAiGenerated: true } }' : '';
  const d = await buffer(`mutation { createPost(input: { text: ${JSON.stringify(caption.slice(0, 2200))} channelId: ${JSON.stringify(ch.id)} schedulingType: automatic mode: ${mode}${due}${ai} assets: [{ video: { url: ${JSON.stringify(url)} } }] }) { __typename ... on PostActionSuccess { post { id dueAt } } ... on MutationError { message } } }`);
  const res = d?.createPost;
  if (!res?.post) throw new Error(`Buffer createPost: ${res?.message ?? JSON.stringify(res)}`);
  return `Buffer ${mode} → ${ch.name} (post ${res.post.id}${res.post.dueAt ? `, due ${res.post.dueAt}` : ''}) video ${url}`;
}

async function ttJson(url: string, token: string, body: unknown) {
  const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify(body) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || (j.error && j.error.code && j.error.code !== 'ok')) throw new Error(`${url.replace(TT, '')}: ${r.status} ${j.error?.code ?? ''} ${j.error?.message ?? ''}`.trim());
  return j.data;
}

/** Refresh the concept's TikTok tokens and write them back to config.json. Returns an access token. */
async function tiktokAccess(drive: any, conceptId: string, config: any): Promise<string> {
  const t = config.apiKeys.tiktok;
  const params = new URLSearchParams({ client_key: process.env.TIKTOK_CLIENT_KEY!, client_secret: process.env.TIKTOK_CLIENT_SECRET!, grant_type: 'refresh_token', refresh_token: t.refresh_token });
  const r = await fetch(`${TT}/v2/oauth/token/`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`token refresh failed: ${j.error ?? r.status} ${j.error_description ?? ''}`.trim());
  config.apiKeys.tiktok = { ...t, ...j };
  const res = await drive.files.list({ q: `'${conceptId}' in parents and name='config.json' and trashed=false`, fields: 'files(id)', pageSize: 1 });
  const id = res.data.files?.[0]?.id;
  try {
    await drive.files.update({ fileId: id, media: { mimeType: 'application/json', body: JSON.stringify(config, null, 2) } });
  } catch (e: any) {
    // the refresh token may have rotated; say so loudly so it can be reconnected before it lapses
    errorLog(`TikTok tokens refreshed but config.json could not be updated: ${e?.message ?? e}`);
  }
  return j.access_token;
}

async function postTikTok(token: string, file: string, title: string): Promise<string> {
  const info = await ttJson(`${TT}/v2/post/publish/creator_info/query/`, token, {});
  const opts: string[] = info?.privacy_level_options ?? [];
  const privacy = ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'].find((p) => opts.includes(p)) ?? 'SELF_ONLY';
  const buf = fs.readFileSync(file);
  const init = await ttJson(`${TT}/v2/post/publish/video/init/`, token, {
    post_info: { title: title.slice(0, 2200), privacy_level: privacy, disable_comment: false, disable_duet: false, disable_stitch: false, is_aigc: true },
    source_info: { source: 'FILE_UPLOAD', video_size: buf.length, chunk_size: buf.length, total_chunk_count: 1 },
  });
  const put = await fetch(init.upload_url, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(buf.length), 'Content-Range': `bytes 0-${buf.length - 1}/${buf.length}` }, body: buf });
  if (!put.ok) throw new Error(`upload failed: ${put.status} ${put.statusText}`);
  let status = 'PROCESSING_UPLOAD';
  for (let i = 0; i < 24 && !/PUBLISH_COMPLETE|FAILED/.test(status); i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await ttJson(`${TT}/v2/post/publish/status/fetch/`, token, { publish_id: init.publish_id });
    status = st?.status ?? status;
    if (status === 'FAILED') throw new Error(`publish failed: ${st?.fail_reason ?? 'unknown'}`);
  }
  return `${status} (${privacy}, publish_id ${init.publish_id})`;
}

async function main() {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!json || !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET are required.');
  const key = JSON.parse(json);
  const auth = new JWT({ email: key.client_email, key: key.private_key, scopes: ['https://www.googleapis.com/auth/drive'] });
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
    const oauth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
    if (refresh) oauth.setCredentials({ refresh_token: refresh });
    const youtube = google.youtube({ version: 'v3', auth: oauth });
    for (const file of fs.readdirSync(dir).filter((f) => /\.(mp4|mov)$/i.test(f))) {
      if (!/^[A-Za-z0-9._-]+$/.test(file)) { errorLog(`Unsafe file name: ${file}`); failures++; continue; }
      const sidecarPath = path.join(dir, file.replace(/\.[^.]+$/, '.json'));
      const meta = { ...(config.postDetails ?? {}), ...(fs.existsSync(sidecarPath) ? JSON.parse(fs.readFileSync(sidecarPath, 'utf8')) : {}) };
      if (!meta.title) { errorLog(`${file}: no title`); failures++; continue; }
      const hashtags: string = meta.hashtags ?? '';
      let description: string = meta.description ?? '';
      if (meta.aiLabel && !description.includes(AI_LABEL_MESSAGE)) description = `${description.trim()}\n\n${AI_LABEL_MESSAGE}`;
      const filePath = path.join(dir, file);

      if (wants(meta, 'youtube')) {
        try {
          if (!refresh) throw new Error(`${concept}: no youtube_refresh_token in config.json`);
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
            media: { mimeType: 'video/mp4', body: fs.createReadStream(filePath) },
          });
          const id = (res as any).data?.id;
          infoLog(`Posted ${concept}/${file} → https://youtube.com/shorts/${id}`);
          summary.push(`| ${concept} | ${file} | https://youtube.com/shorts/${id} |`);
          done++;
        } catch (e: any) {
          errorLog(`Posting ${file} failed:`, e?.message ?? e);
          summary.push(`| ${concept} | ${file} | FAILED: ${String(e?.message ?? e).slice(0, 120)} |`);
          failures++;
          continue; // do not send a video to TikTok that failed on YouTube
        }
      }

      if (wants(meta, 'tiktok')) {
        const caption = [meta.tiktokCaption ?? meta.title, hashtags].filter(Boolean).join(' ');
        const tiktokOnly = !wants(meta, 'youtube');
        try {
          let r: string;
          if (process.env.BUFFER_API_KEY) {
            r = await postTikTokViaBuffer(filePath, `${concept}-${file}`, caption, config, meta);
          } else {
            if (!process.env.TIKTOK_CLIENT_KEY || !process.env.TIKTOK_CLIENT_SECRET) throw new Error('neither BUFFER_API_KEY nor TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET secrets are set');
            if (!config?.apiKeys?.tiktok?.refresh_token) throw new Error(`${concept}: no TikTok account connected (apiKeys.tiktok in config.json)`);
            const token = await tiktokAccess(drive, conceptId, config);
            r = await postTikTok(token, filePath, caption);
          }
          infoLog(`TikTok ${concept}/${file} → ${r}`);
          summary.push(`| ${concept} | ${file} (TikTok) | ${r} |`);
          if (tiktokOnly) done++;
        } catch (e: any) {
          errorLog(`TikTok skipped for ${file}: ${e?.message ?? e}`);
          summary.push(`| ${concept} | ${file} (TikTok) | NOT POSTED: ${String(e?.message ?? e).slice(0, 160)} |`);
          if (tiktokOnly) failures++; // only fail the job when TikTok was the only target (no YouTube re-post risk)
        }
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
