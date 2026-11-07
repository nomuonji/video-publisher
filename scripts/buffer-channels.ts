// List the Buffer organizations and channels the BUFFER_API_KEY can see (no posting).
// Use it once after adding the secret, to check the key and to find the TikTok channel id.
//   BUFFER_API_KEY=... npx tsx scripts/buffer-channels.ts      (workflow "Buffer Channels")
async function q(query: string) {
  const r = await fetch('https://api.buffer.com', { method: 'POST', headers: { Authorization: `Bearer ${process.env.BUFFER_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || j.errors?.length) throw new Error(`Buffer ${r.status}: ${(j.errors ?? []).map((e: any) => e.message).join('; ') || r.statusText}`);
  return j.data;
}
async function main() {
  if (!process.env.BUFFER_API_KEY) throw new Error('BUFFER_API_KEY is not set');
  const acc = await q('query { account { organizations { id name } } }');
  for (const o of acc?.account?.organizations ?? []) {
    console.log(`organization ${o.name ?? ''} ${o.id}`);
    const d = await q(`query { channels(input: { organizationId: ${JSON.stringify(o.id)} }) { id name displayName service isDisconnected isLocked isQueuePaused } }`);
    for (const c of d?.channels ?? []) console.log(`  ${c.service}\t${c.displayName ?? c.name}\t${c.id}${c.isDisconnected ? '\t(disconnected)' : ''}${c.isLocked ? '\t(locked)' : ''}${c.isQueuePaused ? '\t(queue paused)' : ''}`);
  }
}
main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
