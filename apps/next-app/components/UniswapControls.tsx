'use client'
import { useRef, useState } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AgentisClient, type DcaSchedule, type SwapPlan, type SwapQuote, type SwapRequest } from '@agentis-hq/sdk'
import { formatUnits } from 'viem'
import Dropdown from './Dropdown'

const field = 'mt-1 w-full border border-beige-darker bg-beige p-2 text-sm'
const button = 'border border-beige-darker px-3 py-2 text-xs disabled:opacity-40 hover:border-ink'
export default function UniswapControls({ agentId }: { agentId: string }) {
  const { user, getAccessToken } = usePrivy(), cache = useQueryClient()
  const client = new AgentisClient({ baseUrl: process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001', token: async () => { const token = await getAccessToken(); if (!token) throw Error('Sign in again'); return token } })
  const wallets = useQuery({ queryKey: ['wallets', user?.id], queryFn: () => client.wallets.list() })
  const wallet = wallets.data?.find(w => w.agentId === agentId && w.enabled && w.chainId === 'eip155:84532')
  const [tab, setTab] = useState<'swap' | 'rebalance' | 'dca' | 'gas'>('swap')
  const [tokenIn, setTokenIn] = useState<'ETH' | 'USDC'>('ETH'), [amount, setAmount] = useState(''), [slippage, setSlippage] = useState('50'), [fee, setFee] = useState('0.0001')
  const [ethPercent, setEthPercent] = useState<string | null>(null), [interval, setInterval] = useState('1440'), [minimumGas, setMinimumGas] = useState('0.0003'), [targetGas, setTargetGas] = useState('0.001')
  const [quote, setQuote] = useState<SwapQuote | null>(null), [quotedRequest, setQuotedRequest] = useState<SwapRequest | null>(null), [planId, setPlanId] = useState<string | null>(null), [editing, setEditing] = useState<string | null>(null), [notice, setNotice] = useState('')
  const requestKey = useRef('')
  const scheduleKey = useRef('')
  const cancelDialog = useRef<HTMLDialogElement>(null)
  const [cancelSchedule, setCancelSchedule] = useState<DcaSchedule | null>(null)
  const schedules = useQuery({ queryKey: ['uniswap-dca', user?.id, wallet?.id], enabled: !!wallet, queryFn: () => client.uniswap.dca.list(wallet!.id) })
  const target = useQuery({ queryKey: ['uniswap-target', user?.id, wallet?.id], enabled: !!wallet, queryFn: () => client.uniswap.target(wallet!.id) })
  const targetPercent = ethPercent ?? String(target.data?.ethPercent ?? 20)
  const targetSave = useMutation({ mutationFn: () => client.uniswap.saveTarget(wallet!.id, Number(targetPercent)), onSuccess: () => { cache.invalidateQueries({ queryKey: ['uniswap-target'] }); setNotice('Target saved. No automatic rebalancing enabled.') } })
  const plan = useQuery({ queryKey: ['uniswap-plan', user?.id, planId], enabled: !!planId, queryFn: () => client.uniswap.get(planId!), refetchInterval: query => query.state.data?.status === 'pending' ? 2000 : false })
  const request = (): SwapRequest => ({ walletId: wallet!.id, tokenIn, tokenOut: tokenIn === 'ETH' ? 'USDC' : 'ETH', amount, slippageBps: Number(slippage), maxFee: fee })
  function resetQuote() { setQuote(null); setQuotedRequest(null); setNotice('') }
  const preview = useMutation({ mutationFn: async () => {
    if (tab === 'rebalance') {
      const result = await client.uniswap.rebalance(wallet!.id, Number(targetPercent))
      setQuote(result.quote); setQuotedRequest(result.request); if (!result.quote) setNotice('No rebalance needed.')
    } else { const input = request(); setQuote(await client.uniswap.quote(input)); setQuotedRequest(input) }
    requestKey.current = crypto.randomUUID()
  } })
  const execute = useMutation({ mutationFn: async () => {
    if (!quote || !quotedRequest) throw Error('Preview first')
    return client.uniswap.swap({ ...quotedRequest, minimumOutputAtomic: quote.minimumOutputAtomic, maximumInputAtomic: quote.maximumInputAtomic }, { idempotencyKey: requestKey.current })
  }, onSuccess: (result: SwapPlan) => { setPlanId(result.id); cache.setQueryData(['uniswap-plan', user?.id, result.id], result); resetQuote(); cache.invalidateQueries({ queryKey: ['operations'] }) } })
  const save = useMutation({ mutationFn: async () => {
    if (!scheduleKey.current) scheduleKey.current = crypto.randomUUID()
    const input = { id: scheduleKey.current, request: tab === 'gas' ? { walletId: wallet!.id, tokenIn: 'USDC' as const, tokenOut: 'ETH' as const, amount: targetGas, type: 'EXACT_OUTPUT' as const, maxFee: fee, slippageBps: Number(slippage) } : request(), kind: tab === 'gas' ? 'gas_refill' as const : 'dca' as const, minimumGas: tab === 'gas' ? minimumGas : undefined, intervalMinutes: tab === 'gas' ? 5 : Number(interval), confirm: true as const }
    return editing ? client.uniswap.dca.update(editing, input) : client.uniswap.dca.create(input)
  }, onSuccess: () => { scheduleKey.current = ''; setEditing(null); setNotice('Schedule saved. Ask mode still requires approval for each payment.'); cache.invalidateQueries({ queryKey: ['uniswap-dca'] }) } })
  const changeStatus = useMutation({ mutationFn: ({ id, status }: { id: string; status: DcaSchedule['status'] }) => client.uniswap.dca.status(id, status), onSuccess: () => cache.invalidateQueries({ queryKey: ['uniswap-dca'] }) })
  function edit(schedule: DcaSchedule) {
    setEditing(schedule.id); setTab(schedule.kind === 'gas_refill' ? 'gas' : 'dca'); setTokenIn(schedule.request.tokenIn); setAmount(schedule.request.amount); setInterval(String(schedule.intervalMinutes)); setFee(schedule.request.maxFee ?? '0.0001'); setSlippage(String(schedule.request.slippageBps ?? 50)); if (schedule.kind === 'gas_refill') { setTargetGas(schedule.request.amount); setMinimumGas(formatUnits(BigInt(schedule.minimumGasAtomic!), 18)) } resetQuote()
  }
  if (wallets.isPending) return <p className="mt-4 text-sm">Loading wallet…</p>
  if (wallets.error) return <p role="alert" className="mt-4 text-sm">{wallets.error.message}</p>
  if (!wallet) return <p className="mt-4 text-sm text-ink-muted">Enable Base in agent settings to use Uniswap. Other testnets are not supported by this plugin yet.</p>
  const busy = preview.isPending || execute.isPending || save.isPending || changeStatus.isPending || targetSave.isPending
  const error = preview.error ?? execute.error ?? save.error ?? changeStatus.error ?? schedules.error ?? plan.error ?? target.error ?? targetSave.error
  const units = (value: string, symbol: 'ETH' | 'USDC') => `${formatUnits(BigInt(value), symbol === 'ETH' ? 18 : 6)} ${symbol}`
  return <div className="mt-5 space-y-4 border-t border-beige-darker pt-4">
    <div className="flex flex-wrap gap-2">{(['swap', 'rebalance', 'dca', 'gas'] as const).map(value => <button key={value} className={`${button} ${tab === value ? 'bg-black text-beige' : ''}`} disabled={busy} onClick={() => { setTab(value); setEditing(null); resetQuote(); preview.reset(); execute.reset(); save.reset() }}>{value === 'gas' ? 'Gas refill' : value === 'dca' ? 'DCA' : value === 'swap' ? 'Swap' : 'Rebalance'}</button>)}</div>
    <p className="text-xs text-ink-muted">Base Sepolia · Uniswap V3 · Existing agent budgets and approvals apply.</p>
    <fieldset disabled={busy} className="space-y-3">
      {tab === 'rebalance' ? <label className="block text-sm">Target ETH allocation · %<input className={field} type="number" min="0" max="100" value={targetPercent} onChange={e => { setEthPercent(e.target.value); resetQuote() }} /><span className="mt-1 block text-xs text-ink-muted">Remainder USDC. One-time adjustment, not automatic maintenance. Fees affect the final allocation.</span></label> : tab === 'gas' ? <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Refill below · ETH<input className={field} value={minimumGas} onChange={e => setMinimumGas(e.target.value)} /></label><label className="text-sm">Refill target · ETH<input className={field} value={targetGas} onChange={e => setTargetGas(e.target.value)} /></label><p className="text-xs text-ink-muted sm:col-span-2">Check every 5 minutes. Swap USDC into ETH, allowing for bounded approval/swap fees. Keep some ETH for gas—zero-balance rescue is not supported.</p></div> : <div className="grid gap-3 sm:grid-cols-2"><Dropdown label="Sell token" value={tokenIn} options={[{ value: 'ETH', label: 'ETH → USDC' }, { value: 'USDC', label: 'USDC → ETH' }]} onChange={value => { setTokenIn(value as typeof tokenIn); resetQuote() }} /><label className="text-sm">{tab === 'dca' ? 'Amount per run' : 'Amount to sell'}<input className={field} inputMode="decimal" value={amount} onChange={e => { setAmount(e.target.value); resetQuote() }} /></label></div>}
      {tab !== 'rebalance' && <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Slippage · basis points<input className={field} type="number" min="1" max="500" value={slippage} onChange={e => { setSlippage(e.target.value); resetQuote() }} /></label><label className="text-sm">Fee cap per transaction · ETH<input className={field} value={fee} onChange={e => { setFee(e.target.value); resetQuote() }} /></label></div>}
      {tab === 'dca' && <label className="block text-sm">Repeat every · minutes<input className={field} type="number" min="5" value={interval} onChange={e => setInterval(e.target.value)} /></label>}
      {(tab === 'dca' || tab === 'gas') ? <><p className="text-xs text-ink-muted">Automatic mode runs without an agent online. Ask mode requires dashboard approval; missed runs are not accumulated.</p><button className={`${button} bg-black text-beige`} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : editing ? 'Confirm schedule changes' : 'Enable schedule'}</button></> : <div className="flex gap-2"><button className={button} onClick={() => preview.mutate()}>{preview.isPending ? 'Getting quote…' : 'Preview'}</button>{tab === 'rebalance' && <button className={button} onClick={() => targetSave.mutate()}>Save target</button>}</div>}
    </fieldset>
    {quote && <div className="space-y-2 border border-beige-darker p-4 text-sm"><p>{units(quote.inputAtomic, quote.tokenIn)} → {units(quote.outputAtomic, quote.tokenOut)}</p><p className="text-xs">Maximum input: {units(quote.maximumInputAtomic, quote.tokenIn)} · Minimum output: {units(quote.minimumOutputAtomic, quote.tokenOut)}</p><p className="text-xs text-ink-muted">Fee cap: {units(quote.maxFeeAtomic, 'ETH')} per transaction. USDC may first need a separately approved, exact-amount token allowance.</p><button disabled={busy} className={`${button} bg-black text-beige`} onClick={() => execute.mutate()}>{execute.isPending ? 'Requesting…' : 'Request swap'}</button></div>}
    {plan.data && <div className="border border-beige-darker p-4 text-sm"><p>Swap: {plan.data.status}</p>{plan.data.approvalUrl && <a className="mt-2 block underline" href={plan.data.approvalUrl}>Review payment approval →</a>}{plan.data.error && <p className="mt-2">{plan.data.error}</p>}{plan.data.operations.map(operation => <p className="mt-2 text-xs" key={operation.id}><a className="underline" href={`/operations/${operation.id}`}>{operation.action === 'uniswap_approval' ? 'Token allowance' : operation.action === 'uniswap_swap' ? 'Swap' : 'Payment'} · {operation.status}</a>{operation.receipt?.swap && ` · received ${units(operation.receipt.swap.outputAtomic, operation.receipt.swap.tokenOut)}`}</p>)}</div>}
    {(tab === 'dca' || tab === 'gas') && <div className="space-y-3">{schedules.data?.filter(s => s.kind === (tab === 'gas' ? 'gas_refill' : 'dca')).map(schedule => <div className="border border-beige-darker p-3 text-sm" key={schedule.id}><p>{schedule.kind === 'gas_refill' ? `Refill to ${schedule.request.amount} ETH` : `${schedule.request.amount} ${schedule.request.tokenIn} → ${schedule.request.tokenOut} every ${schedule.intervalMinutes} min`}</p><p className="mt-1 text-xs text-ink-muted">{schedule.status} · Next: {new Date(schedule.nextRunAt).toLocaleString()}</p>{schedule.lastError && <p className="mt-2 text-xs">{schedule.lastError}</p>}{!!schedule.runs?.length && <details className="mt-3 text-xs"><summary className="cursor-pointer">Recent runs</summary>{schedule.runs.map(run => <div className="mt-2" key={run.id}><button className="underline" onClick={() => setPlanId(run.id)}>{new Date(run.createdAt).toLocaleString()} · {run.status}</button>{run.operations.map(op => <p key={op.id}>{op.status}{op.receipt?.swap ? ` · received ${units(op.receipt.swap.outputAtomic, op.receipt.swap.tokenOut)}` : ''}</p>)}</div>)}</details>}<div className="mt-3 flex flex-wrap gap-2">{schedule.activePlanId && <button className={button} onClick={() => setPlanId(schedule.activePlanId)}>Latest run</button>}{schedule.status !== 'cancelled' && <><button className={button} disabled={busy} onClick={() => edit(schedule)}>Edit</button><button className={button} disabled={busy} onClick={() => changeStatus.mutate({ id: schedule.id, status: schedule.status === 'active' ? 'paused' : 'active' })}>{schedule.status === 'active' ? 'Pause' : 'Resume'}</button><button className={button} disabled={busy} onClick={() => { changeStatus.reset(); setCancelSchedule(schedule); cancelDialog.current?.showModal() }}>Cancel</button></>}</div></div>)}</div>}
    <dialog ref={cancelDialog} aria-labelledby={`${agentId}-cancel-schedule-title`} aria-describedby={`${agentId}-cancel-schedule-description`} onClose={() => setCancelSchedule(null)} onCancel={event => { if (changeStatus.isPending) event.preventDefault() }} onClick={event => {
      if (event.target !== event.currentTarget || changeStatus.isPending) return
      const bounds = event.currentTarget.getBoundingClientRect()
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close()
    }} className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto border border-beige-darker bg-beige p-6 text-ink shadow-xl backdrop:bg-black/50 sm:p-8">
      <h2 id={`${agentId}-cancel-schedule-title`} className="font-serif text-2xl font-bold">Cancel this schedule?</h2>
      {cancelSchedule && <p className="mt-4 text-sm">{cancelSchedule.kind === 'gas_refill' ? `Gas refill to ${cancelSchedule.request.amount} ETH` : `${cancelSchedule.request.amount} ${cancelSchedule.request.tokenIn} → ${cancelSchedule.request.tokenOut} every ${cancelSchedule.intervalMinutes} min`}</p>}
      <p id={`${agentId}-cancel-schedule-description`} className="mt-3 text-sm text-ink-muted">This stops future runs and cancels unsubmitted scheduled operations. Already-signed or submitted transactions may still settle. This schedule cannot be resumed after cancellation.</p>
      {changeStatus.error && <p role="alert" className="mt-4 text-sm text-red-700">{changeStatus.error.message}</p>}
      <footer className="mt-6 flex justify-end gap-3 border-t border-beige-darker pt-5">
        <button type="button" autoFocus className={button} disabled={changeStatus.isPending} onClick={() => cancelDialog.current?.close()}>Keep schedule</button>
        <button type="button" className={`${button} bg-red-700 text-white hover:bg-red-800`} disabled={!cancelSchedule || changeStatus.isPending} onClick={() => {
          if (!cancelSchedule || changeStatus.isPending) return
          changeStatus.mutate({ id: cancelSchedule.id, status: 'cancelled' }, { onSuccess: () => cancelDialog.current?.close() })
        }}>{changeStatus.isPending ? 'Cancelling…' : 'Cancel schedule'}</button>
      </footer>
    </dialog>
    {notice && <p role="status" className="text-sm">{notice}</p>}{error && <p role="alert" className="text-sm">{error.message}. After an uncertain request, retry the same preview rather than creating another payment.</p>}
  </div>
}
