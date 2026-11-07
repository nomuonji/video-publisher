// Buffer helper for maintenance runs (workflow "Buffer Tool").
//   ACTION=schema   print the parts of the GraphQL schema we use (ShareMode, mutations, Post, PostsInput)
//   ACTION=query    run QUERY (a GraphQL document) and print the JSON result
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
  } else throw new Error(`unknown ACTION ${action}`);
}
main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
