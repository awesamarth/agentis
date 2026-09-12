// Optional compatibility entry point for the existing mcp.agentis.systems URL.
// OAuth, tools and authorization live in the common backend, not this proxy.
export default {
  async fetch(request: Request, env: { AGENTIS_API_URL?: string }): Promise<Response> {
    const path = new URL(request.url).pathname
    if (!['/mcp', '/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'].includes(path)) return Response.json({ error: 'Not found' }, { status: 404 })
    const api = new URL(env.AGENTIS_API_URL ?? 'https://api.agentis.systems')
    if (api.protocol !== 'https:' || api.username || api.password) return Response.json({ error: 'Invalid API configuration' }, { status: 503 })
    const url = new URL(path, api)
    const headers = new Headers(request.headers)
    headers.delete('host')
    return fetch(url, { method: request.method, headers, body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body, redirect: 'manual', signal: request.signal })
  },
}
