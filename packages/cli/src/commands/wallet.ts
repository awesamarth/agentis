import { createLocalWallet, listLocalWallets } from '../lib/local-wallet'
import { getToken } from '../lib/keychain'
import { API_BASE, apiFetch } from '../lib/config'
import { formatHostedAgentLine, formatLocalWalletLine } from '../lib/format-agent'
import type { LocalWallet } from '../lib/local-wallet'

type HostedWallet = {
  id: string
  name: string
  walletAddress: string
  type: 'hosted'
  policyMode: 'backend' | 'onchain'
  onchainPolicy?: {
    initialized: boolean
    programId?: string
  }
  privacyEnabled: boolean
  umbraStatus: string
  umbraRegisteredAt?: string
}

function toHostedWallet(agent: any): HostedWallet {
  return {
    id: agent.id,
    name: agent.name,
    walletAddress: agent.walletAddress,
    type: 'hosted',
    policyMode: agent.policyMode ?? 'backend',
    onchainPolicy: agent.onchainPolicy
      ? {
          initialized: Boolean(agent.onchainPolicy.initialized),
          programId: agent.onchainPolicy.programId,
        }
      : undefined,
    privacyEnabled: Boolean(agent.privacyEnabled),
    umbraStatus: agent.umbraStatus ?? 'disabled',
    umbraRegisteredAt: agent.umbraRegisteredAt,
  }
}

function toLocalWallet(wallet: LocalWallet) {
  return {
    id: wallet.id,
    name: wallet.name,
    walletAddress: wallet.solanaAddress,
    solanaAddress: wallet.solanaAddress,
    type: 'local' as const,
    createdAt: wallet.createdAt,
    policy: wallet.policy,
  }
}

export async function walletCreate(args: string[]) {
  const nameIdx = args.indexOf('--name')
  const name = nameIdx !== -1 ? args[nameIdx + 1] : undefined
  const isLocal = args.includes('--local')

  if (!name) {
    console.error('Usage: agentis wallet create --name <name> [--local]')
    process.exit(1)
  }

  const token = await getToken()

  // If no token or --local flag → always create local
  if (!token || isLocal) {
    const { wallet } = createLocalWallet(name)
    console.log(`\nWallet created (local)`)
    console.log(`  Name:    ${wallet.name}`)
    console.log(`  ID:      ${wallet.id}`)
    console.log(`  Solana:  ${wallet.solanaAddress}`)
    console.log(`  Vault:   ~/.agentis/wallets/${wallet.id}.json\n`)
    if (!token) {
      console.log(`  tip: run \`agentis login\` to create hosted wallets managed by Agentis.\n`)
    }
    return
  }

  // Logged in and no --local → create hosted wallet via backend
  const res = await apiFetch('/account/agents', {
    method: 'POST',
    body: JSON.stringify({ name }),
  }, token)

  if (!res.ok) {
    const data = await res.json()
    console.error('Failed to create hosted wallet:', data.error ?? res.statusText)
    process.exit(1)
  }

  const agent = await res.json()
  console.log(`\nWallet created (hosted)`)
  console.log(`  Name:    ${agent.name}`)
  console.log(`  ID:      ${agent.id}`)
  console.log(`  Solana:  ${agent.walletAddress}`)
  console.log(`  API Key: ${agent.apiKey}\n`)
}

export async function walletList(args: string[] = []) {
  const json = args.includes('--json')
  const token = await getToken()
  const localWallets = listLocalWallets()
  const local = localWallets.map(toLocalWallet)
  const hosted: HostedWallet[] = []
  let hostedError: { status?: number; message: string } | null = null
  let printedHosted = false

  if (token) {
    try {
      const res = await apiFetch('/account/agents', {}, token)
      if (res.ok) {
        const agents = await res.json()
        hosted.push(...agents.map(toHostedWallet))
        if (!json && hosted.length > 0) {
          console.log('\nHosted wallets:')
          for (const a of agents) {
            console.log(formatHostedAgentLine(a))
          }
          printedHosted = true
        } else if (!json) {
          console.log('\nNo hosted wallets found.')
        }
      } else if (res.status === 401) {
        hostedError = { status: res.status, message: 'Stored login is expired or invalid. Run `agentis logout` and then `agentis login`.' }
        if (!json) console.log(`\nCould not list hosted wallets: ${hostedError.message}`)
      } else {
        const data = await res.json().catch(() => ({}))
        hostedError = { status: res.status, message: data.error ?? res.statusText }
        if (!json) console.log(`\nCould not list hosted wallets from ${API_BASE}: ${hostedError.message}`)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      hostedError = { message }
      if (!json) console.log(`\nCould not list hosted wallets from ${API_BASE}: ${message}`)
    }
  } else {
    hostedError = { message: 'Not logged in. Run `agentis login` to list hosted wallets.' }
    if (!json) console.log(`\n${hostedError.message}`)
  }

  if (json) {
    console.log(JSON.stringify({
      apiBase: API_BASE,
      authenticated: Boolean(token),
      hosted,
      hostedError,
      local,
      wallets: [...hosted, ...local],
    }, null, 2))
    return
  }

  if (localWallets.length > 0) {
    console.log('\nLocal wallets:')
    for (const w of localWallets) {
      console.log(formatLocalWalletLine(w))
    }
  }

  if (localWallets.length === 0 && !token) {
    console.log('No wallets found. Run `agentis wallet create --name <name>` to create one.')
  } else if (localWallets.length === 0 && token && !printedHosted) {
    console.log('\nNo local wallets found.')
  }
  console.log()
}
