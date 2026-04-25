import { createLocalWallet, listLocalWallets } from '../lib/local-wallet'
import { getToken } from '../lib/keychain'
import { apiFetch } from '../lib/config'

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

  if (token) {
    try {
      const res = await apiFetch('/account/agents', {}, token)
      if (res.ok) {
        const hosted = await res.json()
        if (hosted.length > 0) {
          console.log('\nHosted wallets:')
          for (const a of hosted) {
            console.log(`  ${a.name.padEnd(20)} ${a.walletAddress}  [${a.id}]`)
          }
        }
      }
    } catch {
      // backend unreachable — skip hosted wallets silently
    }
  }

  if (localWallets.length > 0) {
    console.log('\nLocal wallets:')
    for (const w of localWallets) {
      console.log(`  ${w.name.padEnd(20)} ${w.solanaAddress}  [${w.id}]`)
    }
  }

  if (localWallets.length === 0 && !token) {
    console.log('No wallets found. Run `agentis wallet create --name <name>` to create one.')
  }
  console.log()
}
