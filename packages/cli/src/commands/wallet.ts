import { createLocalWallet, listLocalWallets } from '../lib/local-wallet'
import { getToken } from '../lib/keychain'
import { API_BASE, apiFetch } from '../lib/config'
import { formatHostedAgentLine, formatLocalWalletLine } from '../lib/format-agent'

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

export async function walletList() {
  const token = await getToken()
  const localWallets = listLocalWallets()
  let printedHosted = false

  if (token) {
    try {
      const res = await apiFetch('/account/agents', {}, token)
      if (res.ok) {
        const hosted = await res.json()
        if (hosted.length > 0) {
          console.log('\nHosted wallets:')
          for (const a of hosted) {
            console.log(formatHostedAgentLine(a))
          }
          printedHosted = true
        } else {
          console.log('\nNo hosted wallets found.')
        }
      } else if (res.status === 401) {
        console.log(`\nCould not list hosted wallets: stored login is expired or invalid. Run \`agentis logout\` and then \`agentis login\`.`)
      } else {
        const data = await res.json().catch(() => ({}))
        console.log(`\nCould not list hosted wallets from ${API_BASE}: ${data.error ?? res.statusText}`)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.log(`\nCould not list hosted wallets from ${API_BASE}: ${message}`)
    }
  } else {
    console.log('\nNot logged in. Run `agentis login` to list hosted wallets.')
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
