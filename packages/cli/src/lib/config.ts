export const API_BASE = process.env.AGENTIS_API_URL ?? 'http://localhost:3001'

export async function apiFetch(path: string, opts: RequestInit = {}, token?: string | null): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(opts.headers as Record<string, string> ?? {}),
  }
  if (token) headers['authorization'] = `Bearer ${token}`
  return fetch(`${API_BASE}${path}`, { ...opts, headers })
}
