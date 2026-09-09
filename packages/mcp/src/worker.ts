// Deliberately fail closed during the auth rewrite. Do not forward legacy OAuth
// tokens to the new execution API. Remote per-client grants must be integrated
// and tested before restoring this transport. Local stdio uses executor grants.
export default {
  async fetch(_request: Request): Promise<Response> {
    return Response.json({ error: 'Remote MCP temporarily unavailable during authorization migration. Use scoped local stdio.' }, {
      status: 503, headers: { 'cache-control': 'no-store', 'retry-after': '3600' },
    })
  },
}
