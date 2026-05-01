import { getToken } from '../lib/keychain'
import { apiFetch } from '../lib/config'
import { fetchAccountAgents, resolveAccountAgent } from '../lib/account'
import { address, getAddressEncoder, getProgramDerivedAddress } from '@solana/kit'

const MAINNET_RPC = process.env.AGENTIS_MAINNET_RPC_URL ?? 'https://api.mainnet-beta.solana.com'
const USDC_MAINNET_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const ASSOCIATED_TOKEN_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
const addressEncoder = getAddressEncoder()

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
    case 'sweep':
      await earnSweep(args.slice(1))
      break
    default:
      console.log('Usage: agentis earn <deposit|positions|sweep>')
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

async function mainnetRpc<T>(method: string, params: unknown[]): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(MAINNET_RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    const data = await res.json() as any
    if (!data.error) return data.result as T

    const message = data.error.message ?? `RPC ${method} failed`
    const isRateLimit = /too many requests|rate/i.test(message)
    if (!isRateLimit || attempt === 4) throw new Error(message)
    await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)))
  }

  throw new Error(`RPC ${method} failed`)
}

async function getAssociatedTokenAddress(owner: string, mint: string): Promise<string> {
  const [ata] = await getProgramDerivedAddress({
    programAddress: address(ASSOCIATED_TOKEN_PROGRAM),
    seeds: [
      addressEncoder.encode(address(owner)),
      addressEncoder.encode(address(TOKEN_PROGRAM)),
      addressEncoder.encode(address(mint)),
    ],
  })
  return ata
}

function readSplTokenAmountFromBase64(data: string): bigint {
  const bytes = Buffer.from(data, 'base64')
  if (bytes.length < 72) return 0n
  return bytes.readBigUInt64LE(64)
}

async function getMainnetUsdcBalancesAtomic(walletAddresses: string[]): Promise<Map<string, bigint>> {
  const entries = await Promise.all(
    walletAddresses.map(async wallet => ({
      wallet,
      ata: await getAssociatedTokenAddress(wallet, USDC_MAINNET_MINT),
    })),
  )
  const balances = new Map<string, bigint>()

  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100)
    const result = await mainnetRpc<{ value: ({ data: [string, string] } | null)[] }>('getMultipleAccounts', [
      chunk.map(entry => entry.ata),
      { encoding: 'base64', commitment: 'confirmed' },
    ])

    for (let j = 0; j < chunk.length; j++) {
      const account = result.value?.[j]
      const amount = account ? readSplTokenAmountFromBase64(account.data[0]) : 0n
      balances.set(chunk[j]!.wallet, amount)
    }
  }

  return balances
}

function atomicToUiString(amount: bigint, decimals = 6): string {
  const base = 10n ** BigInt(decimals)
  const whole = amount / base
  const fraction = amount % base
  if (fraction === 0n) return whole.toString()
  return `${whole}.${fraction.toString().padStart(decimals, '0').replace(/0+$/, '')}`
}

type SweepPlanItem = {
  agent: any
  usdcAtomic: bigint
  amountUi: string
}

async function buildSweepPlan(token: string): Promise<SweepPlanItem[]> {
  const agents = await fetchAccountAgents(token)
  const plan: SweepPlanItem[] = []
  const balances = await getMainnetUsdcBalancesAtomic(agents.map(agent => agent.walletAddress))

  for (const agent of agents) {
    const usdcAtomic = balances.get(agent.walletAddress) ?? 0n
    plan.push({
      agent,
      usdcAtomic,
      amountUi: atomicToUiString(usdcAtomic, 6),
    })
  }

  return plan
}

function printSweepPlan(plan: SweepPlanItem[]) {
  const sweepable = plan.filter(item => item.usdcAtomic > 0n)
  const totalAtomic = sweepable.reduce((sum, item) => sum + item.usdcAtomic, 0n)

  console.log('\nJupiter Earn sweep dry-run (mainnet USDC)')
  if (plan.length === 0) {
    console.log('  No hosted agents found.\n')
    return
  }

  for (const item of plan) {
    const action = item.usdcAtomic > 0n ? 'sweep' : 'skip'
    const usdc = atomicToUiString(item.usdcAtomic, 6)
    console.log(`  ${item.agent.name.padEnd(22)} ${action.padEnd(5)} ${usdc.padStart(12)} USDC`)
    console.log(`  ${' '.repeat(22)} wallet ${item.agent.walletAddress}`)
  }

  console.log(`\n  Total sweepable: ${atomicToUiString(totalAtomic, 6)} USDC across ${sweepable.length} agent(s).\n`)
}

async function executeSweep(token: string, plan: SweepPlanItem[]) {
  const sweepable = plan.filter(item => item.usdcAtomic > 0n)
  if (sweepable.length === 0) return

  console.log('Executing Jupiter Earn sweep...')
  for (const item of sweepable) {
    console.log(`\nDepositing ${item.amountUi} USDC from ${item.agent.name}...`)
    const res = await apiFetch(`/agents/${item.agent.id}/earn/deposit`, {
      method: 'POST',
      body: JSON.stringify({
        network: 'mainnet',
        asset: 'USDC',
        amount: item.amountUi,
      }),
    }, token)

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      console.error(`  Failed: ${data.error ?? res.statusText}`)
      continue
    }

    console.log(`  Signature: ${data.signature}`)
    console.log(`  Explorer:  https://solscan.io/tx/${data.signature}`)
  }
  console.log()
}

async function earnSweep(args: string[]) {
  const dryRun = args.includes('--dry-run')
  const noDryRun = args.includes('--no-dry-run')

  if (dryRun && noDryRun) {
    console.error('Use either --dry-run or --no-dry-run, not both.')
    process.exit(1)
  }

  const token = await requireAuth()
  const plan = await buildSweepPlan(token)

  if (dryRun) {
    printSweepPlan(plan)
    return
  }

  if (!noDryRun) {
    printSweepPlan(plan)
  }

  await executeSweep(token, plan)
}
