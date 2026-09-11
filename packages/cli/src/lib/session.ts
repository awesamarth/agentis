import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { setTimeout } from 'node:timers/promises'
import { AgentisClient, type CliCredential } from '@agentis-hq/sdk'

const directory = join(homedir(), '.agentis')
const file = join(directory, 'cli-session.json')
type Session = { version: 1; apiUrl: string; credentials: CliCredential[] }
export const apiUrl = () => (process.env.AGENTIS_API_URL ?? 'http://localhost:3001').replace(/\/$/, '')
function privateDirectory() {
  if (!existsSync(directory)) mkdirSync(directory, { mode: 0o700 })
  if (lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory()) throw Error('CLI configuration directory must not be a symlink')
  chmodSync(directory, 0o700)
}
export function readSession(): Session | null {
  privateDirectory()
  if (!existsSync(file)) return null
  const stat = lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('CLI session must be a regular file, not a symlink')
  if (process.platform !== 'win32' && (stat.mode & 0o077)) throw Error('CLI session permissions are unsafe; run chmod 600 ~/.agentis/cli-session.json')
  let session: Session
  try { session = JSON.parse(readFileSync(file, 'utf8')) as Session }
  catch { throw Error('Could not read CLI login. Run agentis logout, then login again; revoke unused keys in the dashboard') }
  if (session.version !== 1 || !Array.isArray(session.credentials) || !session.credentials.length || session.credentials.some(c => !/^agt_exec_[a-f0-9]{64}$/.test(c.token) || !c.agentId || !Array.isArray(c.chainIds) || !c.chainIds.length)) throw Error('Invalid CLI session; log out locally and log in again')
  if (session.apiUrl !== apiUrl()) throw Error('Stored login belongs to a different API URL; set AGENTIS_API_URL to that server or log out first')
  return session
}
export async function login(noBrowser = false) {
  if (process.env.AGENTIS_TOKEN) throw Error('Unset AGENTIS_TOKEN before browser login; it overrides stored credentials')
  if (readSession()) throw Error('Already linked. Run agentis logout before connecting a new selection; revoke old keys in the dashboard if no longer needed')
  const secret = randomBytes(32).toString('hex')
  const client = new AgentisClient({ baseUrl: apiUrl(), token: '' })
  const request = await client.cliLogin.start(createHash('sha256').update(secret).digest('hex'))
  const url = new URL(request.approvalUrl)
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw Error('Unsafe login URL')
  console.error(`Open: ${url.href}\nConfirmation code: ${request.code}\nChoose agents and wallets in the browser. Waiting for owner approval…`)
  if (!noBrowser && ['darwin', 'linux'].includes(process.platform)) {
    const child = spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url.href], { stdio: 'ignore', detached: true })
    child.on('error', () => console.error('Open the link above manually.'))
    child.unref()
  }
  while (Date.now() < Date.parse(request.expiresAt)) {
    const result = await client.cliLogin.exchange(request.id, secret)
    if (result.status === 'complete') {
      // Exclusive creation cannot silently replace another login. No owner JWT,
      // raw wallet key or exchange secret is stored. Filesystem protection only.
      try { writeFileSync(file, JSON.stringify({ version: 1, apiUrl: apiUrl(), credentials: result.credentials } satisfies Session, null, 2), { mode: 0o600, flag: 'wx' }) }
      catch { throw Error(`CLI keys were issued but could not be saved. Revoke these keys in the dashboard before retrying: ${result.credentials.map(c => c.id).join(', ')}`) }
      return { connected: result.credentials.map(({ token: _token, ...credential }) => credential), storage: file }
    }
    await setTimeout(2000)
  }
  throw Error('Login expired; run agentis login again')
}
export function logout() {
  privateDirectory()
  if (existsSync(file)) {
    if (lstatSync(file).isSymbolicLink()) throw Error('Refusing to remove a symlinked session')
    unlinkSync(file)
  }
  return { message: 'Local login removed. To revoke server access too, revoke the CLI keys in each agent’s dashboard API access panel.' }
}
export function sessions(agent?: string) {
  if (agent && process.env.AGENTIS_TOKEN) throw Error('--agent selects a stored login credential; unset AGENTIS_TOKEN first')
  if (process.env.AGENTIS_TOKEN) return [{ client: new AgentisClient({ baseUrl: apiUrl(), token: process.env.AGENTIS_TOKEN }), agentId: null, agentName: 'AGENTIS_TOKEN' }]
  const session = readSession()
  if (!session) throw Error('Run agentis login or set AGENTIS_TOKEN first')
  const credentials = agent ? session.credentials.filter(c => c.agentId === agent || c.agentName === agent) : session.credentials
  if (!credentials.length || (agent && credentials.length !== 1)) throw Error('Choose an unambiguous linked agent ID with --agent; see agentis whoami')
  return credentials.map(c => ({ client: new AgentisClient({ baseUrl: session.apiUrl, token: c.token }), agentId: c.agentId, agentName: c.agentName }))
}
export function whoami() {
  if (process.env.AGENTIS_TOKEN) return { source: 'AGENTIS_TOKEN (overrides stored login)', apiUrl: apiUrl() }
  const session = readSession()
  if (!session) return { connected: false }
  return { apiUrl: session.apiUrl, agents: session.credentials.map(({ token: _token, ...credential }) => credential) }
}
