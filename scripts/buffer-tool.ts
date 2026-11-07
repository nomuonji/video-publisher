// Buffer helper for maintenance runs (workflow "Buffer Tool").
//   ACTION=schema   print the parts of the GraphQL schema we use (ShareMode, mutations, Post, PostsInput)
//   ACTION=query    run QUERY (a GraphQL document) and print the JSON result
//   ACTION=failed   one line per failed post (status error): id, channel, created, error, text
//   ACTION=retry    IDS=comma separated post ids, MODE=shareNow|addToQueue|shareNext → editPost(mode) on each
//   ACTION=sharenow IDS=... same as retry with MODE=shareNow
async function q(query: string, variables: Record<string, unknown> = {}) {
  const r = await fetch('https://api.buffer.com', { method: 'POST', headers: { Authorization: `Bearer ${process.env.BUFFER_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || j.errors?.length) throw new Error(`Buffer ${r.status}: ${JSON.stringify(j.errors ?? r.statusText)}`);
  return j.data;
}
const typeRef = 'kind name ofType { kind name ofType { kind name ofType { kind name } } }';
async function main() {
  if (!process.env.BUFFER_API_KEY) throw new Error('BUFFER_API_KEY is not set');
  const action = process.env.ACTION ?? 'schema';
  if (action === 'schema') {
    const d = await q(`query { __schema { mutationType { fields { name args { name type { ${typeRef} } } } } queryType { fields { name args { name type { ${typeRef} } } } } } }`);
    console.log('MUTATIONS', JSON.stringify(d.__schema.mutationType.fields.map((f: any) => f.name)));
    console.log('QUERIES', JSON.stringify(d.__schema.queryType.fields.map((f: any) => ({ n: f.name, a: f.args.map((a: any) => a.name) }))));
    for (const t of (process.env.TYPES || 'ShareMode,SchedulingType,CreatePostInput,PostsInput,PostsFiltersInput,Post,PostStatus,EditPostInput,UpdatePostInput,DeletePostInput,AssetInput,VideoAssetInput,Asset').split(',')) {
      const d2 = await q(`query($n: String!) { __type(name: $n) { kind name enumValues { name } inputFields { name type { ${typeRef} } } fields { name type { ${typeRef} } } possibleTypes { name } } }`, { n: t });
      const ty = d2.__type;
      if (!ty) { console.log(`TYPE ${t}: (none)`); continue; }
      const nm = (x: any): string => x ? (x.name ?? `${x.kind}(${nm(x.ofType)})`) : '';
      console.log(`TYPE ${t} ${ty.kind}:`, JSON.stringify(ty.enumValues?.map((e: any) => e.name) ?? (ty.inputFields ?? ty.fields ?? []).map((f: any) => `${f.name}:${nm(f.type)}`) ?? ty.possibleTypes));
      if (ty.possibleTypes) console.log('  possible', JSON.stringify(ty.possibleTypes.map((p: any) => p.name)));
    }
  } else if (action === 'query') {
    console.log(JSON.stringify(await q(process.env.QUERY!, JSON.parse(process.env.VARIABLES || '{}')), null, 1));
  } else if (action === 'failed') {
    const acc = await q('query { account { organizations { id } } }');
    for (const o of acc.account.organizations) {
      let after: string | null = null, n = 0;
      const byCh: Record<string, number> = {};
      do {
        const d: any = await q(`query($org: OrganizationId!, $after: String) { posts(first: 100, after: $after, input: { organizationId: $org, filter: { status: [error] } }) { edges { node { id channel { name isDisconnected } createdAt dueAt text error { rawError } allowedActions } } pageInfo { hasNextPage endCursor } } }`, { org: o.id, after });
        for (const { node: p } of d.posts.edges ?? []) {
          n++; const ch = `${p.channel.name}${p.channel.isDisconnected ? '(disconnected)' : ''}`; byCh[ch] = (byCh[ch] ?? 0) + 1;
          console.log([p.id, ch, p.createdAt.slice(0, 10), (p.error?.rawError ?? '').slice(0, 60), p.text.replace(/\s+/g, ' ').slice(0, 50)].join('\t'));
        }
        after = d.posts.pageInfo.hasNextPage ? d.posts.pageInfo.endCursor : null;
      } while (after);
      console.log(`TOTAL ${n}`, JSON.stringify(byCh));
    }
  } else if (action === 'retry' || action === 'sharenow') {
    const mode = action === 'sharenow' ? 'shareNow' : (process.env.MODE || 'addToQueue');
    if (!['shareNow', 'addToQueue', 'shareNext'].includes(mode)) throw new Error(`bad MODE ${mode}`);
    const ids = (process.env.IDS ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    if (!ids.length) throw new Error('IDS is empty');
    let ok = 0;
    for (const id of ids) {
      try {
        const d = await q(`mutation($id: PostId!) { editPost(input: { id: $id, mode: ${mode}, schedulingType: automatic }) { __typename ... on PostActionSuccess { post { id status dueAt channel { name } } } ... on MutationError { message } } }`, { id });
        const r = d.editPost;
        if (r?.post) { ok++; console.log(`OK ${id} ${r.post.channel.name} ${r.post.status} due ${r.post.dueAt}`); }
        else console.log(`NG ${id} ${r?.__typename}: ${r?.message}`);
      } catch (e: any) { console.log(`NG ${id} ${e?.message ?? e}`); }
    }
    console.log(`${ok}/${ids.length} updated (${mode})`);
    if (!ok) process.exit(1);
  } else throw new Error(`unknown ACTION ${action}`);
}
main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
