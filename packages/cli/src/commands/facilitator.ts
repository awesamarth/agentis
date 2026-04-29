import { mkdir, readdir, readFile, stat, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { basename, dirname, join, resolve } from 'path'
import { randomBytes } from 'crypto'
import { getToken } from '../lib/keychain'
import { API_BASE, apiFetch } from '../lib/config'

const DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
const SOLANA_DEVNET_NETWORK = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'

async function requireAuth(): Promise<string> {
  const token = await getToken()
  if (!token) {
    console.error('Not logged in. Run `agentis login` first.')
    process.exit(1)
  }
  return token
}

function flag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name)
  return idx === -1 ? undefined : args[idx + 1]
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name)
}

function firstPositional(args: string[], valueFlags: string[] = []): string | undefined {
  const skip = new Set<number>()
  for (const valueFlag of valueFlags) {
    const idx = args.indexOf(valueFlag)
    if (idx !== -1) {
      skip.add(idx)
      skip.add(idx + 1)
    }
  }
  return args.find((part, idx) => !skip.has(idx) && !part.startsWith('--'))
}

function parseFeeBps(value: string | undefined): number {
  if (!value) return 500
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10_000) {
    console.error('--fee-bps must be between 0 and 10000')
    process.exit(1)
  }
  return parsed
}

async function renderTemplateDir(sourceDir: string, targetDir: string, values: Record<string, string>) {
  const entries = await readdir(sourceDir)
  await mkdir(targetDir, { recursive: true })

  for (const entry of entries) {
    const sourcePath = join(sourceDir, entry)
    const stats = await stat(sourcePath)
    const targetName = entry.endsWith('.tpl') ? entry.slice(0, -4) : entry
    const targetPath = join(targetDir, targetName)

    if (stats.isDirectory()) {
      await renderTemplateDir(sourcePath, targetPath, values)
      continue
    }

    let content = await readFile(sourcePath, 'utf8')
    for (const [key, value] of Object.entries(values)) {
      content = content.replaceAll(`{{${key}}}`, value)
    }
    await mkdir(dirname(targetPath), { recursive: true })
    await writeFile(targetPath, content)
  }
}

export async function facilitatorCommand(args: string[]) {
  const sub = args[0]
  switch (sub) {
    case 'create':
      await facilitatorCreate(args.slice(1))
      break
    case 'list':
      await facilitatorList()
      break
    case 'publish':
      await facilitatorPublish(args.slice(1))
      break
    default:
      console.log('Usage: agentis facilitator <create|list|publish>')
  }
}

async function facilitatorCreate(args: string[]) {
  const name = firstPositional(args, ['--dir', '--network', '--mint', '--fee-bps'])
  if (!name) {
    console.error('Usage: agentis facilitator create <name> [--dir <path>] [--network solana-devnet] [--mint <mint>] [--fee-bps <bps>] [--listed]')
    process.exit(1)
  }

  const token = await requireAuth()
  const network = flag(args, '--network') ?? SOLANA_DEVNET_NETWORK
  const acceptedMint = flag(args, '--mint') ?? DEVNET_USDC
  const feeBps = parseFeeBps(flag(args, '--fee-bps'))
  const targetDir = resolve(flag(args, '--dir') ?? `agentis-facilitator-${name}`)

  if (existsSync(targetDir)) {
    console.error(`Target directory already exists: ${targetDir}`)
    process.exit(1)
  }

  const res = await apiFetch('/account/facilitators', {
    method: 'POST',
    body: JSON.stringify({
      name,
      network,
      acceptedMint,
      feeBps,
      listed: hasFlag(args, '--listed'),
    }),
  }, token)

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    console.error('Failed to register facilitator:', data.error ?? res.statusText)
    process.exit(1)
  }

  const facilitator = await res.json()
  const templateDir = join(import.meta.dir, '../../templates/facilitator')
  const koraApiKey = 'kora_' + randomBytes(24).toString('hex')

  await renderTemplateDir(templateDir, targetDir, {
    NAME: name,
    FACILITATOR_ID: facilitator.id,
    HEARTBEAT_SECRET: facilitator.heartbeatSecret,
    AGENTIS_API_URL: API_BASE,
    NETWORK: network,
    ACCEPTED_MINT: acceptedMint,
    FEE_BPS: String(feeBps),
    KORA_API_KEY: koraApiKey,
  })

  console.log('\nFacilitator scaffold created')
  console.log(`  Name:      ${name}`)
  console.log(`  ID:        ${facilitator.id}`)
  console.log(`  Directory: ${targetDir}`)
  console.log(`  Fee:       ${feeBps} bps`)
  console.log('\nNext:')
  console.log(`  cd ${targetDir}`)
  console.log('  bun install')
  console.log('  cp .env.example .env')
  console.log('  # fill KORA_PRIVATE_KEY and fund the Kora signer with SOL')
  console.log('  bun run dev\n')
}

async function facilitatorList() {
  const token = await requireAuth()
  const res = await apiFetch('/account/facilitators', {}, token)
  if (!res.ok) {
    console.error('Failed to fetch facilitators')
    process.exit(1)
  }

  const facilitators = await res.json()
  if (facilitators.length === 0) {
    console.log('No facilitators found. Run `agentis facilitator create <name>`.')
    return
  }

  console.log()
  for (const f of facilitators) {
    const url = f.publicUrl ? ` ${f.publicUrl}` : ''
    const listed = f.listed ? ' listed' : ''
    console.log(`  ${f.name.padEnd(24)} ${f.status.padEnd(10)} ${f.id}${listed}${url}`)
  }
  console.log()
}

async function facilitatorPublish(args: string[]) {
  const nameOrId = firstPositional(args, ['--url'])
  const publicUrl = flag(args, '--url')
  if (!nameOrId || !publicUrl) {
    console.error('Usage: agentis facilitator publish <name-or-id> --url <public-url> [--listed]')
    process.exit(1)
  }

  const token = await requireAuth()
  const list = await apiFetch('/account/facilitators', {}, token)
  if (!list.ok) {
    console.error('Failed to fetch facilitators')
    process.exit(1)
  }

  const facilitators = await list.json()
  const facilitator = facilitators.find((f: any) => f.id === nameOrId || f.name === nameOrId)
  if (!facilitator) {
    console.error(`Facilitator not found: ${nameOrId}`)
    process.exit(1)
  }

  const res = await apiFetch(`/account/facilitators/${facilitator.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      publicUrl,
      listed: hasFlag(args, '--listed') ? true : facilitator.listed,
    }),
  }, token)

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    console.error('Failed to publish facilitator:', data.error ?? res.statusText)
    process.exit(1)
  }

  const updated = await res.json()
  console.log(`Published ${updated.name}: ${updated.publicUrl}`)
}
