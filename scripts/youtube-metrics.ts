// YouTube Analytics for already-published videos, read with the concept's own refresh token
// (Drive v-stock/<concept>/config.json -> apiKeys.youtube_refresh_token), exactly like Queue From Repo.
// Needs the yt-analytics.readonly scope on that token (re-auth in the app's "YouTube認証" if missing).
//
//   MODE=check                      only verify that the Analytics API answers for the concept's channel
//   MODE=video  VIDEOS="ID:YYYY-MM-DD:尺秒 ID2:YYYY-MM-DD:尺秒"
//                                   numbers for each video in the window publishDate .. publishDate+2d
//                                   (the same "d2" window across videos; videos younger than 3 days are skipped)
//
// CONCEPT defaults to おもしろ. Read-only: nothing is posted or written back.
// Output: a readable table in the log, plus one "METRICS_JSON {...}" line per video for machines.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

for (const k of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_SERVICE_ACCOUNT_JSON']) {
  if (!process.env[k]) { console.error(`Missing env var: ${k}`); process.exit(1); }
}

const concept = (process.env.CONCEPT || 'おもしろ').trim();
const mode = (process.env.MODE || 'check').trim();
const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!);
const drive = google.drive({ version: 'v3', auth: new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/drive'] }) });

async function findFolder(name: string, parent?: string): Promise<string | null> {
  const q = [`mimeType='application/vnd.google-apps.folder'`, `name='${name.replace(/'/g, "\\'")}'`, 'trashed=false'];
  if (parent) q.push(`'${parent}' in parents`);
  const r = await drive.files.list({ q: q.join(' and '), fields: 'files(id)', pageSize: 1 });
  return r.data.files?.[0]?.id || null;
}

async function refreshToken(): Promise<string> {
  const v = await findFolder('v-stock');
  const c = v && (await findFolder(concept, v));
  if (!c) throw new Error(`concept folder "${concept}" not found under v-stock`);
  const l = await drive.files.list({ q: `'${c}' in parents and name='config.json' and trashed=false`, fields: 'files(id)', pageSize: 1 });
  const id = l.data.files?.[0]?.id;
  if (!id) throw new Error('config.json not found');
  const g = await drive.files.get({ fileId: id, alt: 'media' }, { responseType: 'text' });
  const cfg: any = typeof g.data === 'string' ? JSON.parse(g.data) : g.data;
  const t = cfg?.apiKeys?.youtube_refresh_token;
  if (!t) throw new Error('no youtube_refresh_token in config.json');
  return t;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0));

function explain(e: any): string {
  const msg = String(e?.errors?.[0]?.message || e?.message || e);
  const status = e?.code ?? e?.response?.status;
  if (/insufficient|scope/i.test(msg) || status === 403) return `${msg} → 権限不足（insufficient scope）の可能性。アプリの「YouTube認証」で「${concept}」を再認証（yt-analytics.readonly を付ける）`;
  if (/invalid_grant/i.test(msg)) return `${msg} → refresh token が失効。アプリの「YouTube認証」で「${concept}」を再認証`;
  return msg;
}

async function main() {
  const oauth2 = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: await refreshToken() });
  const ana = google.youtubeAnalytics({ version: 'v2', auth: oauth2 });
  const query = async (p: any) => (await ana.reports.query({ ids: 'channel==MINE', ...p })).data;

  if (mode === 'check') {
    const end = iso(new Date());
    const d = await query({ startDate: addDays(end, -7), endDate: end, metrics: 'views,estimatedMinutesWatched' });
    console.log(`OK: Analytics API answers for "${concept}". 直近7日 ${JSON.stringify(d.rows?.[0] ?? [])} (views, 視聴分)`);
    return;
  }
  if (mode !== 'video') throw new Error(`unknown MODE "${mode}" (check | video)`);

  const today = iso(new Date());
  const items = (process.env.VIDEOS || '').split(/\s+/).filter(Boolean);
  if (!items.length) throw new Error('VIDEOS is empty (format: ID:YYYY-MM-DD:尺秒)');
  let failed = 0;

  for (const it of items) {
    const [id, date, durS] = it.split(':');
    const dur = Number(durS);
    const start = date, end = addDays(date, 2);
    if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) { console.log(`- ${it}: 形式が違う（ID:YYYY-MM-DD:尺秒）`); failed++; continue; }
    if (end >= addDays(today, -1)) { console.log(`- ${id} (${date}): 公開から3日たっていない。窓 ${start}〜${end} が未確定なので取らない`); continue; }
    try {
      const f = `video==${id}`;
      const m = await query({ startDate: start, endDate: end, filters: f, metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,likes,comments,shares' });
      const r = (m.rows?.[0] ?? []).map(num);
      const views = r[0] ?? 0;
      const out: any = { id, postedAt: date, window: `${start}..${end}`, durationSec: dur || null, views, minutesWatched: r[1] ?? 0, avgViewSec: r[2] ?? 0, avgViewPct: r[3] ?? 0, subsGained: r[4] ?? 0, likes: r[5] ?? 0, comments: r[6] ?? 0, shares: r[7] ?? 0 };
      try {
        const t = await query({ startDate: start, endDate: end, filters: f, dimensions: 'insightTrafficSourceType', metrics: 'views' });
        out.trafficSources = Object.fromEntries((t.rows ?? []).map((x: any[]) => [x[0], num(x[1])]));
        out.shortsFeedViews = out.trafficSources.SHORTS ?? 0;
      } catch (e) { out.trafficSourcesError = explain(e); }
      try {
        const ret = await query({ startDate: start, endDate: end, filters: f, dimensions: 'elapsedVideoTimeRatio', metrics: 'audienceWatchRatio' });
        const pts = (ret.rows ?? []).map((x: any[]) => [num(x[0]), num(x[1])] as [number, number]).sort((a, b) => a[0] - b[0]);
        if (pts.length && dur > 0) {
          const at = (sec: number) => { const ratio = sec / dur; let best = pts[0]; for (const p of pts) if (Math.abs(p[0] - ratio) < Math.abs(best[0] - ratio)) best = p; return Math.round(best[1] * 1000) / 1000; };
          out.retention = { '3s': at(3), '5s': at(5), '10s': at(10), '20s': at(20), last: pts[pts.length - 1][1] };
        }
      } catch (e) { out.retentionError = explain(e); }
      console.log(`- ${id} (${date}, ${dur || '?'}s): 再生 ${views} / 平均視聴 ${out.avgViewSec}s (${out.avgViewPct}%) / 登録者増 ${out.subsGained} / Shortsフィード ${out.shortsFeedViews ?? '?'} / 維持率 ${out.retention ? JSON.stringify(out.retention) : '(取れず)'}`);
      console.log(`METRICS_JSON ${JSON.stringify(out)}`);
    } catch (e) {
      failed++;
      console.log(`- ${id} (${date}): NG ${explain(e)}`);
    }
  }
  if (failed) process.exit(1);
}

main().catch((e) => { console.error('metrics failed:', explain(e)); process.exit(1); });
