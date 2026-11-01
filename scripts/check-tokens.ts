import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

const PREFIX = process.env.CONCEPT_PREFIX || '';

async function main() {
  const key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!);
  const auth = new JWT({ email: key.client_email, key: key.private_key, scopes: ['https://www.googleapis.com/auth/drive'] });
  const drive = google.drive({ version: 'v3', auth });
  const list = async (q: string, fields: string) => (await drive.files.list({ q, fields, pageSize: 100 })).data.files || [];
  const v = (await list(`mimeType='application/vnd.google-apps.folder' and name='v-stock' and trashed=false`, 'files(id)'))[0];
  const folders = await list(`'${v.id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`, 'files(id,name)');
  const igFile = (await list(`'${v.id}' in parents and name='instagram_accounts.json' and trashed=false`, 'files(id)'))[0];
  const igAccounts: any[] = igFile ? (await drive.files.get({ fileId: igFile.id!, alt: 'media' })).data as any : [];

  for (const f of folders) {
    if (!f.name!.startsWith(PREFIX)) continue;
    const cf = (await list(`'${f.id}' in parents and name='config.json' and trashed=false`, 'files(id)'))[0];
    if (!cf) continue;
    const cfg: any = (await drive.files.get({ fileId: cf.id!, alt: 'media' })).data;
    const tag = `${f.name!.slice(0, 2)}***`;
    console.log(`[${tag}] platforms:`, JSON.stringify(cfg.platforms));

    // YouTube
    if (cfg.apiKeys?.youtube_refresh_token) {
      try {
        const o = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
        o.setCredentials({ refresh_token: cfg.apiKeys.youtube_refresh_token });
        const { credentials } = await o.refreshAccessToken();
        console.log(`[${tag}] YouTube: ${credentials.access_token ? 'OK (refresh succeeded)' : 'NG (no access token)'}`);
      } catch (e: any) {
        console.log(`[${tag}] YouTube: NG`, e?.response?.data?.error || e?.message);
      }
    } else console.log(`[${tag}] YouTube: no refresh token stored`);

    // Instagram
    const acc = igAccounts.find(a => a.id === cfg.apiKeys?.instagram);
    if (!cfg.apiKeys?.instagram) console.log(`[${tag}] Instagram: not configured`);
    else if (!acc) console.log(`[${tag}] Instagram: account not found in instagram_accounts.json`);
    else {
      const r = await fetch(`https://graph.facebook.com/v19.0/${acc.id}?fields=id&access_token=${encodeURIComponent(acc.page_access_token)}`);
      const j: any = await r.json();
      console.log(`[${tag}] Instagram: ${r.ok ? 'OK' : 'NG'}`, r.ok ? '' : `code=${j?.error?.code} sub=${j?.error?.error_subcode} ${j?.error?.message}`);
    }

    // TikTok (stored values only)
    const t = cfg.apiKeys?.tiktok;
    console.log(`[${tag}] TikTok:`, t ? `stored (refresh_expires_in=${t.refresh_expires_in}, expires_in=${t.expires_in})` : 'not configured');
  }
}
main().catch(e => { console.error('failed:', e?.message); process.exit(1); });
