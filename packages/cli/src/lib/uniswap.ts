import { select, text, confirm, isCancel } from '@clack/prompts'
import { formatUnits } from 'viem'
import type { SwapRequest, SwapQuote, SwapPlan, DcaInput } from '@agentis-hq/sdk'
import { sessions } from './session'

type Values = Record<string, string | boolean | undefined>
const str = (v: Values, key: string) => typeof v[key] === 'string' ? v[key] as string : undefined
function answer<T>(value: T | symbol): T { if (isCancel(value)) throw Error('Cancelled'); return value as T }
export async function uniswapAvailable(agent?: string) {
  try { const choices = sessions(agent, true); return choices.length === 1 && (await choices[0]!.client.wallets.list()).some(w => w.enabled && w.agentPlugins?.includes('uniswap')) } catch { return false }
}
export const uniswapHelp = `Uniswap (selected agent only; Base Sepolia):
  swap quote|execute [--from ETH|USDC] [--to ETH|USDC] [--amount <decimal>] [--exact-output] [--key <stable-key>]
  swap get <plan-id>
  rebalance [--eth-percent 20] [--preview] [--key <stable-key>]
  dca create|list|show|edit|pause|resume|cancel [schedule-id]
    [--from USDC --to ETH --amount 1 --every-minutes 1440]
  Add --agent <name-or-id>, --wallet <id>, --slippage-bps 50, --max-fee 0.0001, --json or --yes.
  Missing inputs prompt interactively. DCA changes return an owner confirmation URL.
  fetch ... --swap-funding opts into swapping missing Base USDC before payment.`
function quoteText(q: SwapQuote) {
  const amount = (value: string, token: 'ETH' | 'USDC') => formatUnits(BigInt(value), token === 'ETH' ? 18 : 6)
  return `${q.protocol} · Base Sepolia\n${amount(q.inputAtomic, q.tokenIn)} ${q.tokenIn} → ${amount(q.outputAtomic, q.tokenOut)} ${q.tokenOut}\nMaximum input: ${amount(q.maximumInputAtomic, q.tokenIn)} ${q.tokenIn}\nMinimum output: ${amount(q.minimumOutputAtomic, q.tokenOut)} ${q.tokenOut}\nFee cap per transaction: ${formatUnits(BigInt(q.maxFeeAtomic), 18)} ETH`
}
export function planText(plan: SwapPlan) {
  return `${quoteText(plan.quote)}\nPlan: ${plan.id}\nStatus: ${plan.status}${plan.approvalUrl ? `\nApproval required: ${plan.approvalUrl}` : ''}${plan.error ? `\n${plan.error}` : ''}\n${plan.operations.map(op => `${op.action}: ${op.status}${op.transactionHash ? ` · ${op.transactionHash}` : ''}`).join('\n')}\nCheck: agentis swap get ${plan.id}`
}
export async function runUniswap(command: string, subcommand: string | undefined, id: string | undefined, values: Values) {
  const interactive = !!process.stdin.isTTY && !!process.stdout.isTTY && !values.json
  const choices = sessions(str(values, 'agent'))
  let item = choices[0]!
  if (choices.length !== 1) {
    if (!interactive) throw Error('Select --agent')
    item = choices[answer(await select({ message: 'Agent', options: choices.map((c, index) => ({ value: index, label: c.agentName })) }))]!
  }
  const available = (await item.client.wallets.list()).filter(w => w.enabled && w.chainId === 'eip155:84532' && w.agentPlugins?.includes('uniswap') && (!values.agent || w.agentId === values.agent || w.agentName?.toLowerCase() === String(values.agent).toLowerCase()))
  let selectedWallet = str(values, 'wallet') ? available.find(w => w.id === values.wallet) : available.length === 1 ? available[0] : undefined
  if (!selectedWallet && !values.wallet && available.length > 1 && interactive) {
    const selected = answer(await select({ message: 'Agent wallet', options: available.map(w => ({ value: w.id, label: w.agentName ?? w.id })) }))
    selectedWallet = available.find(w => w.id === selected)
  }

  if (!selectedWallet) throw Error('Select an enabled Uniswap Base wallet with --agent/--wallet, or add Uniswap in the dashboard.')
  const wallet = selectedWallet
  if (values.help) { console.log(uniswapHelp); return }
  const client = item.client
  const prompt = async (flag: string, message: string, initial?: string) => {
    const supplied = str(values, flag)
    if (supplied !== undefined) return supplied
    if (!interactive) { if (initial !== undefined) return initial; throw Error(`--${flag} required`) }
    return answer(await text({ message, initialValue: initial, validate: value => value?.trim() ? undefined : 'Required' }))
  }
  const token = async (flag: string, initial: 'ETH' | 'USDC') => {
    const value = str(values, flag)?.toUpperCase() ?? (interactive ? answer(await select({ message: flag === 'from' ? 'Sell token' : 'Buy token', initialValue: initial, options: [{ value: 'ETH', label: 'ETH' }, { value: 'USDC', label: 'USDC' }] })) : initial)
    if (value !== 'ETH' && value !== 'USDC') throw Error('Choose ETH or USDC')
    return value
  }
  const request = async (): Promise<SwapRequest> => {
    const tokenIn = await token('from', 'USDC'), tokenOut = await token('to', tokenIn === 'ETH' ? 'USDC' : 'ETH')
    return { walletId: wallet.id, tokenIn, tokenOut, amount: await prompt('amount', values['exact-output'] ? `Amount of ${tokenOut} to receive` : `Amount of ${tokenIn} to sell`), type: values['exact-output'] ? 'EXACT_OUTPUT' : 'EXACT_INPUT', slippageBps: Number(str(values, 'slippage-bps') ?? '50'), maxFee: str(values, 'max-fee') ?? '0.0001', minimumOutputAtomic: str(values, 'minimum-output-atomic'), maximumInputAtomic: str(values, 'maximum-input-atomic') }
  }
  const key = () => { const value = str(values, 'key') ?? (interactive ? crypto.randomUUID() : undefined); if (!value) throw Error('--key required; preserve it after uncertainty'); if (!values.json) console.log(`Request key: ${value}`); return value }
  const consent = async () => { if (values.yes) return; if (!interactive) throw Error('Use --yes to submit noninteractively; it does not bypass owner approval'); if (!answer(await confirm({ message: 'Request this execution?', initialValue: false }))) throw Error('Cancelled') }
  const print = (data: unknown, human: string) => console.log(values.json ? JSON.stringify(data, null, 2) : `\n${human}\n`)
  if (command === 'swap') {
    const action = subcommand ?? (interactive ? answer(await select({ message: 'Swap action', options: [{ value: 'quote', label: 'Quote' }, { value: 'execute', label: 'Execute' }] })) : 'quote')
    if (action === 'get') { if (!id) throw Error('Plan ID required'); const plan = await client.uniswap.get(id); print(plan, planText(plan)); return }
    if (!['quote', 'execute'].includes(action)) throw Error('Use swap quote, execute or get')
    const input = await request()
    if (action === 'quote') { const quote = await client.uniswap.quote(input); print(quote, quoteText(quote)); return }
    const requestKey = key()
    // With --yes, do not refresh preview terms on retries: the backend returns the persisted plan.
    if (interactive && !values.yes) {
      const quote = await client.uniswap.quote(input)
      input.minimumOutputAtomic = quote.minimumOutputAtomic; input.maximumInputAtomic = quote.maximumInputAtomic
      console.log(`${quoteText(quote)}\nRetry bounds: --minimum-output-atomic ${quote.minimumOutputAtomic} --maximum-input-atomic ${quote.maximumInputAtomic}`)
    }
    await consent()
    const plan = await client.uniswap.swap(input, { idempotencyKey: requestKey }); print(plan, planText(plan)); return
  }
  if (command === 'rebalance') {
    const target = Number(await prompt('eth-percent', 'Target ETH percentage (remainder USDC)', String((await client.uniswap.target(wallet.id)).ethPercent)))
    if (values.preview) { const preview = await client.uniswap.rebalance(wallet.id, target); print(preview, preview.quote ? quoteText(preview.quote) : 'No rebalance needed'); return }
    const requestKey = key()
    if (interactive && !values.yes) { const preview = await client.uniswap.rebalance(wallet.id, target); console.log(preview.quote ? quoteText(preview.quote) : 'No rebalance needed') }
    await consent()
    const plan = await client.uniswap.executeRebalance(wallet.id, target, { idempotencyKey: requestKey }); print(plan, plan ? planText(plan) : 'No rebalance needed'); return
  }
  const action = subcommand ?? 'list', schedules = await client.uniswap.dca.list(wallet.id)
  if (action === 'list' || action === 'show') {
    const found = action === 'show' ? schedules.filter(s => s.id === id) : schedules
    if (action === 'show' && !found.length) throw Error('Schedule not found')
    print(found, found.map(s => `${s.id}\n${s.request.amount} ${s.request.tokenIn} → ${s.request.tokenOut} every ${s.intervalMinutes} minutes\n${s.status} · next ${s.nextRunAt}${s.lastError ? `\n${s.lastError}` : ''}${action === 'show' && s.runs?.length ? '\nRecent runs:\n' + s.runs.map(run => `${run.createdAt} · ${run.status} · ${run.id}`).join('\n') : ''}`).join('\n\n') || 'No schedules'); return
  }
  if (!['create', 'edit', 'pause', 'resume', 'cancel'].includes(action)) throw Error('Unknown DCA action')
  let scheduleId = id
  if (action !== 'create' && !scheduleId) {
    if (!interactive || !schedules.length) throw Error('Schedule ID required')
    scheduleId = answer(await select({ message: 'Schedule', options: schedules.map(s => ({ value: s.id, label: `${s.request.amount} ${s.request.tokenIn} → ${s.request.tokenOut} · ${s.status}` })) }))
  }
  if (scheduleId && !schedules.some(s => s.id === scheduleId)) throw Error('Schedule is outside the selected wallet')
  let input: DcaInput | undefined
  if (action === 'create' || action === 'edit') input = { request: await request(), intervalMinutes: Number(await prompt('every-minutes', 'Frequency in minutes', '1440')), confirm: true }
  const setup = await client.uniswap.dca.requestSetup({ action: action === 'resume' ? 'active' : action === 'pause' ? 'paused' : action === 'cancel' ? 'cancelled' : action as 'create' | 'edit', scheduleId, input })
  print(setup, `Owner confirmation required:\n${setup.approvalUrl}\nNo schedule changes occur until confirmed.`)
}
