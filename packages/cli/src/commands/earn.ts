import { getToken } from '../lib/keychain'
import { apiFetch } from '../lib/config'
import { resolveAccountAgent } from '../lib/account'

function getFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag)
  return idx === -1 ? undefined : args[idx + 1]
}

async function requireAuth(): Promise<string> {
  const token = await getToken()
  if (!token) {
    console.error('Not logged in. Run `agentis login` first.')
    process.exit(1)
  }
  return token
}

export async function earnCommand(args: string[]) {
  const sub = args[0]
  switch (sub) {
    case 'deposit':
      await earnDeposit(args.slice(1))
      break
    case 'positions':
      await earnPositions(args.slice(1))
      break
    default:
      console.log('Usage: agentis earn <deposit|positions>')
  }
}

async function earnDeposit(args: string[]) {
  const agentName = args[0]
  const asset = getFlag(args, '--asset') ?? 'USDC'
  const amount = getFlag(args, '--amount')
  const mainnet = args.includes('--mainnet')

  if (!agentName || !amount || !mainnet) {
    console.error('Usage: agentis earn deposit <agent> --asset USDC --amount <amount> --mainnet')
    process.exit(1)
  }

  const amountNum = Number(amount)
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    console.error('Invalid amount')
    process.exit(1)
  }

  const token = await requireAuth()
  const agent = await resolveAccountAgent(agentName, token)

  console.log(`\nDepositing ${amountNum} ${asset.toUpperCase()} into Jupiter Earn from ${agent.name} on mainnet...`)

  const res = await apiFetch(`/agents/${agent.id}/earn/deposit`, {
    method: 'POST',
    body: JSON.stringify({
      network: 'mainnet',
      asset,
      amount: amountNum,
    }),
  }, token)

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    console.error('Earn deposit failed:', data.error ?? res.statusText)
    process.exit(1)
  }

  console.log('\nEarn deposit submitted.')
  console.log(`  Signature: ${data.signature}`)
  console.log(`  Amount:    ${data.amount} ${asset.toUpperCase()}`)
  console.log(`  Explorer:  https://solscan.io/tx/${data.signature}\n`)
}

async function earnPositions(args: string[]) {
  const agentName = args[0]
  const mainnet = args.includes('--mainnet')
  const showAll = args.includes('--all')

  if (!agentName || !mainnet) {
    console.error('Usage: agentis earn positions <agent> --mainnet [--all]')
    process.exit(1)
  }

  const token = await requireAuth()
  const agent = await resolveAccountAgent(agentName, token)
  const res = await apiFetch(`/agents/${agent.id}/earn/positions?network=mainnet`, {}, token)
  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    console.error('Earn positions failed:', data.error ?? res.statusText)
    process.exit(1)
  }

  const positions = Array.isArray(data.positions) ? data.positions : []
  const visible = showAll
    ? positions
    : positions.filter((p: any) => Number(p.underlyingAssets ?? 0) > 0 || Number(p.shares ?? 0) > 0)

  console.log(`\nJupiter Earn positions for ${agent.name} (${data.walletAddress})`)
  if (visible.length === 0) {
    console.log(showAll ? '  No positions returned.' : '  No non-zero positions. Use --all to show empty vaults.')
    console.log()
    return
  }

  for (const p of visible) {
    const symbol = p.token?.asset?.uiSymbol ?? p.token?.asset?.symbol ?? p.token?.symbol ?? 'UNKNOWN'
    const jlSymbol = p.token?.uiSymbol ?? p.token?.symbol ?? 'jlToken'
    const decimals = Number(p.token?.asset?.decimals ?? p.token?.decimals ?? 6)
    const underlyingUi = Number(p.underlyingAssets ?? 0) / 10 ** decimals
    const sharesUi = Number(p.shares ?? 0) / 10 ** Number(p.token?.decimals ?? decimals)
    console.log(`  ${symbol.padEnd(8)} ${underlyingUi.toFixed(6)} supplied  (${sharesUi.toFixed(6)} ${jlSymbol})`)
    console.log(`           token: ${p.token?.address ?? 'unknown'}`)
  }
  console.log()
}
