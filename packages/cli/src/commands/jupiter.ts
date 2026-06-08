import { getToken } from '../lib/keychain'
import { apiFetch } from '../lib/config'
import { resolveAccountAgent } from '../lib/account'

function getFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag)
}

async function auth() {
  const token = await getToken()
  if (!token) {
    console.error('Not logged in. Run `agentis login` first.')
    process.exit(1)
  }
  return token
}

async function request(path: string, token: string, init: RequestInit = {}) {
  const response = await apiFetch(path, init, token)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error ?? `Agentis API failed (${response.status})`)
  return body
}

function tradeBody(args: string[]) {
  const input = getFlag(args, '--from')
  const output = getFlag(args, '--to')
  const amount = getFlag(args, '--amount')
  const slippage = getFlag(args, '--slippage-bps')
  if (!input || !output || !amount) {
    throw new Error('--from, --to, and --amount are required')
  }
  return {
    input,
    output,
    amount,
    ...(slippage ? { slippageBps: Number(slippage) } : {}),
  }
}

function printToken(token: any) {
  const trust = token.audit?.isSus
    ? 'suspicious'
    : token.isVerified
      ? 'verified'
      : 'unverified'
  console.log(`  ${(token.symbol ?? '?').padEnd(10)} ${token.name ?? ''}`)
  console.log(`             ${token.id}`)
  console.log(`             ${trust} · decimals=${token.decimals} · organic=${token.organicScoreLabel ?? 'unknown'}`)
}

export async function financialCommand(args: string[]) {
  const area = args[0]
  const action = args[1]
  const token = await auth()

  if (area === 'tokens' && action === 'search') {
    const query = args.slice(2).filter(value => !value.startsWith('--')).join(' ').trim()
    if (!query) throw new Error('Usage: agentis tokens search <query>')
    const data = await request(`/agents/jupiter/tokens?query=${encodeURIComponent(query)}`, token)
    if (hasFlag(args, '--json')) return console.log(JSON.stringify(data, null, 2))
    console.log(`\nJupiter tokens matching "${query}"\n`)
    const matches = data.tokens ?? []
    for (const item of matches.slice(0, 20)) printToken(item)
    if (matches.length > 20) console.log(`  ...and ${matches.length - 20} more. Use --json for the full result.`)
    console.log()
    return
  }

  if (area === 'swap' && (action === 'quote' || action === 'execute')) {
    const agentName = args[2]
    if (!agentName) throw new Error(`Usage: agentis swap ${action} <agent> --from SOL --to USDC --amount 0.1`)
    const agent = await resolveAccountAgent(agentName, token)
    const data = await request(
      `/agents/${agent.id}/jupiter/swap${action === 'quote' ? '/quote' : ''}`,
      token,
      { method: 'POST', body: JSON.stringify(tradeBody(args.slice(3))) },
    )
    if (hasFlag(args, '--json')) return console.log(JSON.stringify(data, null, 2))
    const quote = data.quote ?? data.order ?? {}
    console.log(`\nJupiter swap ${action === 'quote' ? 'quote' : 'executed'} for ${agent.name}`)
    console.log(`  ${data.amountUi} ${data.inputToken?.symbol ?? data.inputToken?.id} -> ${data.outputToken?.symbol ?? data.outputToken?.id}`)
    console.log(`  Expected out: ${quote.outAmount ?? data.result?.outputAmountResult ?? 'unknown'} atomic`)
    console.log(`  Router:       ${quote.router ?? 'unknown'}`)
    if (data.result?.signature) console.log(`  Signature:    ${data.result.signature}`)
    console.log()
    return
  }

  if (area === 'portfolio') {
    const agentName = args[1]
    if (!agentName) throw new Error('Usage: agentis portfolio <agent> [--json]')
    const agent = await resolveAccountAgent(agentName, token)
    const data = await request(`/agents/${agent.id}/jupiter/portfolio`, token)
    if (hasFlag(args, '--json')) return console.log(JSON.stringify(data, null, 2))
    const elements = data.portfolio?.elements ?? []
    console.log(`\nJupiter portfolio for ${agent.name}`)
    console.log(`  Positions: ${elements.length}`)
    for (const item of elements.slice(0, 20)) {
      console.log(`  ${(item.label ?? item.type ?? 'position').padEnd(18)} $${Number(item.value ?? 0).toFixed(2)} · ${item.platformId ?? 'jupiter'}`)
    }
    console.log()
    return
  }

  if (area === 'recurring' && action === 'list') {
    const agentName = args[2]
    if (!agentName) throw new Error('Usage: agentis recurring list <agent> [--history] [--json]')
    const agent = await resolveAccountAgent(agentName, token)
    const status = hasFlag(args, '--history') ? 'history' : 'active'
    const data = await request(`/agents/${agent.id}/jupiter/recurring?status=${status}`, token)
    if (hasFlag(args, '--json')) return console.log(JSON.stringify(data, null, 2))
    const orders = Array.isArray(data.orders) ? data.orders : data.orders?.orders ?? []
    console.log(`\n${status} Jupiter recurring orders for ${agent.name}`)
    if (!orders.length) console.log('  None.')
    for (const order of orders) {
      console.log(`  ${order.orderKey ?? order.publicKey ?? order.id ?? 'unknown'} · ${order.status ?? status}`)
    }
    console.log()
    return
  }

  if (area === 'recurring' && action === 'create') {
    const agentName = args[2]
    if (!agentName) throw new Error('Usage: agentis recurring create <agent> --from USDC --to SOL --amount 100 --orders 2 --interval 86400')
    const agent = await resolveAccountAgent(agentName, token)
    const numberOfOrders = Number(getFlag(args, '--orders'))
    const intervalSeconds = Number(getFlag(args, '--interval'))
    const data = await request(`/agents/${agent.id}/jupiter/recurring`, token, {
      method: 'POST',
      body: JSON.stringify({
        ...tradeBody(args.slice(3)),
        numberOfOrders,
        intervalSeconds,
        startAt: getFlag(args, '--start-at') ? Number(getFlag(args, '--start-at')) : undefined,
      }),
    })
    if (hasFlag(args, '--json')) return console.log(JSON.stringify(data, null, 2))
    console.log(`\nRecurring order created for ${agent.name}`)
    console.log(`  Order:     ${data.result?.order ?? 'submitted'}`)
    console.log(`  Signature: ${data.result?.signature ?? 'unknown'}\n`)
    return
  }

  if (area === 'recurring' && action === 'cancel') {
    const agentName = args[2]
    const order = args[3]
    if (!agentName || !order) throw new Error('Usage: agentis recurring cancel <agent> <order>')
    const agent = await resolveAccountAgent(agentName, token)
    const data = await request(`/agents/${agent.id}/jupiter/recurring/${encodeURIComponent(order)}/cancel`, token, { method: 'POST' })
    if (hasFlag(args, '--json')) return console.log(JSON.stringify(data, null, 2))
    console.log(`\nRecurring order cancelled for ${agent.name}`)
    console.log(`  Signature: ${data.result?.signature ?? 'unknown'}\n`)
    return
  }

  console.log('Usage: agentis <tokens|swap|portfolio|recurring> ...')
}
