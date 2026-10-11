import { createHash, randomUUID } from 'node:crypto'
import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentisClient } from '@agentis-hq/sdk'

export type PaymentRequestOptions = { key?: string; retry?: string }
type SavedRequest = { version: 1; id: string; scope: string; action: string; inputHash: string; createdAt: string }
const scopes = new WeakMap<AgentisClient, string>()
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Scope saved identities to the exact API and credential, without storing credentials. */
export function requestClient(client: AgentisClient, baseUrl: string, token: string) {
  scopes.set(client, digest(JSON.stringify([baseUrl, token])))
  return client
}

function inputHash(input: unknown): string {
  const ordered = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(ordered)
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, ordered(item)]))
    return value
  }
  // Only checks that an explicit retry has unchanged terms. NEVER used as a payment key.
  return digest(JSON.stringify(ordered(JSON.parse(JSON.stringify(input)))))
}

function directory() {
  const root = join(homedir(), '.agentis'), path = join(root, 'payment-requests')
  for (const candidate of [root, path]) {
    if (!existsSync(candidate)) {
      try { mkdirSync(candidate, { mode: 0o700 }) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    }
    const stat = lstatSync(candidate)
    if (!stat.isDirectory() || stat.isSymbolicLink() || (process.platform !== 'win32' && ((stat.mode & 0o077) || stat.uid !== process.getuid!()))) throw Error('Payment request directory must be private and not a symlink')
  }
  return path
}

function readRequest(path: string, id: string): SavedRequest {
  if (!uuid.test(id)) throw Error('Use --retry <request-id> or --retry latest')
  const fd = openSync(join(path, `${id}.json`), constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > 4096 || (process.platform !== 'win32' && ((stat.mode & 0o077) || stat.uid !== process.getuid!()))) throw Error('Unsafe saved payment request')
    const row = JSON.parse(readFileSync(fd, 'utf8')) as SavedRequest
    if (row.version !== 1 || row.id !== id || !/^[a-f0-9]{64}$/.test(row.scope) || !/^[a-f0-9]{64}$/.test(row.inputHash) || typeof row.action !== 'string' || !Number.isFinite(Date.parse(row.createdAt))) throw Error('Invalid saved payment request')
    return row
  } finally { closeSync(fd) }
}

function saveRequest(path: string, request: SavedRequest) {
  const fd = openSync(join(path, `${request.id}.json`), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  try { writeFileSync(fd, JSON.stringify(request)); fsyncSync(fd) } finally { closeSync(fd) }
  // Failure here stops BEFORE sending. Never continue with an unsaved request identity.
  const dir = openSync(path, constants.O_RDONLY)
  try { fsyncSync(dir) } finally { closeSync(dir) }
}

/** New invocation = new UUID. Only an explicit retry reuses a saved request. No paid retries here. */
export async function paymentRequest<T>(client: AgentisClient, action: string, input: unknown, options: PaymentRequestOptions, send: (options: { idempotencyKey: string }) => Promise<T>): Promise<T> {
  if (options.key !== undefined) {
    if (options.retry !== undefined) throw Error('Choose --key or --retry, not both')
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(options.key)) throw Error('--key must contain 1–128 safe characters')
    return send({ idempotencyKey: options.key })
  }
  const scope = scopes.get(client)
  if (!scope) throw Error('Payment client has no credential-bound request journal')
  const path = directory(), fingerprint = inputHash(input)
  let request: SavedRequest
  if (options.retry !== undefined) {
    if (options.retry === 'latest') {
      const matches = readdirSync(path).filter(name => uuid.test(name.replace(/\.json$/, '')) && name.endsWith('.json')).map(name => readRequest(path, name.slice(0, -5))).filter(row => row.scope === scope && row.action === action).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      if (!matches.length) throw Error('No saved request for this command and credential; no payment sent')
      if (matches[1]?.createdAt === matches[0]!.createdAt) throw Error('Latest request is ambiguous; choose its request ID explicitly')
      request = matches[0]!
    } else request = readRequest(path, options.retry.toLowerCase())
    if (request.scope !== scope || request.action !== action || request.inputHash !== fingerprint) throw Error('Retry differs from the saved API, credential, command or payment terms; no payment sent')
  } else {
    request = { version: 1, id: randomUUID(), scope, action, inputHash: fingerprint, createdAt: new Date().toISOString() }
    saveRequest(path, request)
  }
  // Safe identifier only. No request bodies, headers, tokens, card captures or provider results are stored/logged.
  process.stderr.write(`Request ID: ${request.id}\nTo retry this request, repeat the same command with --retry ${request.id}; a bare command creates a NEW request.\n`)
  return send({ idempotencyKey: request.id })
}
