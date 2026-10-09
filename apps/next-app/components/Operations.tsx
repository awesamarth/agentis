'use client'
import { useState } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { type Operation } from '@agentis-hq/sdk'
import { paymentTransfers } from '@agentis-hq/core/operations'
import { useAgentisClient } from '@/lib/agentis'
import { formatUnits } from 'viem'
import { ArrowUpRight, LoaderCircle } from 'lucide-react'
import Dropdown from './Dropdown'

export default function Operations({ id, agentId }: { id?: string; agentId?: string }) {
  const { ready, authenticated, user, login } = usePrivy()
  const queries = useQueryClient()
  const [visibleCount, setVisibleCount] = useState(10)
  const [environment, setEnvironment] = useState('all')
  const [chainId, setChainId] = useState('all')
  const client = useAgentisClient('Sign in first')
  const networks = useQuery({ queryKey: ['onboarding', user?.id], enabled: ready && authenticated, queryFn: () => client.onboarding.get() })
  const key = ['operations', user?.id, id, agentId]
  const query = useQuery({ queryKey: key, enabled: ready && authenticated, queryFn: async () => id ? [await client.operations.get(id)] : client.operations.list(agentId), refetchInterval: 5000 })
  const decision = useMutation({ mutationFn: async ({ operation, approve }: { operation: Operation; approve: boolean }) => {
    if (!approve) return client.operations.reject(operation.id, operation.operationHash)
    return client.operations.approve(operation.id, operation.operationHash)
  }, onSuccess: () => queries.invalidateQueries({ queryKey: ['operations'] }) })
  if (!ready) return <p role="status">Loading your payments…</p>
  if (!authenticated) return <button className="border p-3" onClick={login}>Sign in to review payments</button>
  const layout = (compact: string, review: string) => id ? review : compact
  const matchingEnvironment = (testnet?: boolean) => environment === 'all' || (environment === 'testnet' ? testnet === true : testnet === false)
  const filtered = query.data?.filter(operation => id || ((chainId === 'all' || operation.chainId === chainId) && matchingEnvironment(networks.data?.networks.find(network => network.chainId === operation.chainId)?.testnet)))
  const availableNetworks = networks.data?.networks.filter(network => matchingEnvironment(network.testnet)) ?? []
  return <section className="space-y-4">
    <div className="border-b border-beige-darker pb-4"><h2 className="font-serif text-2xl font-bold">{id ? 'Review payment' : agentId ? 'Payment activity' : 'All payments'}</h2><p className="mt-2 text-sm text-ink-muted">{id ? 'Check the amount and recipient before you approve.' : agentId ? 'Requests, approvals and receipts for this agent.' : 'Requests, approvals and receipts across all your agents.'}</p></div>
    {!id && <div className="flex flex-wrap gap-4">
      <Dropdown label="Environment" className="min-w-40 text-sm" value={environment} onChange={value => { setEnvironment(value); setChainId('all'); setVisibleCount(10) }} options={[{ value: 'all', label: 'All environments' }, { value: 'mainnet', label: 'Mainnet only' }, { value: 'testnet', label: 'Testnet only' }]} />
      <Dropdown label="Network" className="min-w-40 text-sm" value={chainId} onChange={value => { setChainId(value); setVisibleCount(10) }} options={[{ value: 'all', label: 'All networks' }, ...availableNetworks.map(network => ({ value: network.chainId, label: `${network.name}${network.testnet ? ' · Testnet' : ' · Mainnet'}` }))]} />
    </div>}
    {query.isPending && <p>Loading…</p>}
    {query.error && <p role="alert">{query.error.message}</p>}
    {decision.error && <p role="alert">{decision.error.message}</p>}
    {query.data?.length === 0 && <div className="border border-dashed border-beige-darker p-10 text-center"><h3 className="font-serif text-xl font-bold">Your first payment starts here.</h3><p className="mt-2 text-sm text-ink-muted">{agentId ? 'Payments requested by this agent will appear here.' : 'Create a payment above. Requests from your agents will appear here too.'}</p></div>}
    {!!query.data?.length && filtered?.length === 0 && <p role="status" className="py-6 text-sm text-ink-muted">No payments match these filters.</p>}
    {filtered?.slice(0, id ? 1 : visibleCount).map(operation => {
      const network = networks.data?.networks.find(network => network.chainId === operation.chainId)
      const asset = network?.assets.find(asset => operation.asset.startsWith('erc20:') ? asset.id.toLowerCase() === operation.asset.toLowerCase() : asset.id === operation.asset)
      const feeAsset = network?.assets.find(asset => asset.id.toLowerCase() === operation.feeAsset?.toLowerCase())
      const paidRequest = operation.mpp ?? operation.payment
      const paidFee = operation.receipt?.feePayment
      const paidFeeSymbol = network?.assets.find(asset => asset.id.toLowerCase() === paidFee?.asset.toLowerCase())?.symbol ?? paidFee?.asset
      const status = { pending_approval: 'Needs approval', queued: 'Approved', submitting: 'Sending', submitted: 'Confirming', unknown: 'Checking payment', confirmed: 'Completed', failed: 'Failed', denied: 'Not allowed', expired: 'Expired', rejected: 'Declined' }[operation.status]
      const approving = decision.isPending && decision.variables?.approve && decision.variables.operation.id === operation.id && operation.status === 'pending_approval'
      const processing = ['queued', 'submitting', 'submitted'].includes(operation.status)
      const explorer = network && operation.transactionHash ? `${network.explorer}/tx/${encodeURIComponent(operation.transactionHash)}${network.chainId.startsWith('solana:') && network.testnet ? '?cluster=devnet' : ''}` : null
      const createdTime = <p className="text-xs leading-relaxed text-ink-muted">Created <time dateTime={operation.createdAt}>{new Date(operation.createdAt).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}</time></p>
      const requestDetails = paidRequest && (paidRequest.body !== undefined || paidRequest.bodyBase64 !== undefined || paidRequest.headers) && <details className={`${layout('min-w-0 max-w-full open:basis-full', 'mt-3')} text-xs`}>
        <summary className="cursor-pointer">Approved HTTP request details</summary>
        <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded border border-beige-darker p-3">{JSON.stringify({ method: paidRequest.method ?? 'GET', headers: Object.fromEntries(Object.entries(paidRequest.headers ?? {}).map(([key, value]) => [key, /authorization|api[-_]?key|token|secret/i.test(key) ? '[credential supplied]' : value])), ...(paidRequest.body !== undefined ? { body: paidRequest.body } : {}), ...(paidRequest.bodyBase64 !== undefined ? { bodyBase64: paidRequest.bodyBase64 } : {}) }, null, 2)}</pre>
      </details>
      return <article className={`border border-beige-darker bg-[#faf7f1] ${layout('p-5 sm:p-6', 'p-5 sm:p-7')}`} key={operation.id}>
        <div className={layout('flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6', 'flex flex-wrap items-start justify-between gap-4')}>
          <div className={layout('flex min-w-0 flex-col gap-2', 'flex min-w-0 flex-col')}>
            <h3 className={`break-all font-serif font-bold ${layout('text-xl leading-tight', 'order-2 mt-2 text-3xl')}`}>{asset ? `${formatUnits(BigInt(operation.amountAtomic), asset.decimals)} ${asset.symbol}` : `${operation.amountAtomic} atomic units`}</h3>
            <p className="break-all font-mono text-[10px] uppercase tracking-widest text-ink-muted">{network?.name ?? operation.chainId}{network && <span className="ml-2 inline-block border border-beige-darker px-1.5 py-0.5">{network.testnet ? 'Testnet' : 'Mainnet'}</span>}</p>
          </div>
          <div className={layout('flex flex-col items-start gap-2 sm:max-w-xs sm:items-end sm:text-right', '')}>
            <span className={`inline-block border ${layout('px-2.5 py-1', 'px-3 py-2')} font-mono text-[10px] uppercase tracking-widest ${operation.status === 'pending_approval' ? 'border-ink bg-beige-dark' : operation.status === 'rejected' ? 'border-red-300 bg-red-50/40 text-red-700' : 'border-beige-darker text-ink-muted'}`}>{status}</span>
            {!id && createdTime}
          </div>
        </div>
        {id && <div className="mt-3">{createdTime}</div>}
        {operation.ens && <p className="mt-3 text-sm"><strong>{operation.ens.name}</strong> · resolved on Ethereum Sepolia. Approval is bound to the recipient address below.</p>}
        {operation.identity && <div className="mt-3 space-y-2 text-sm"><p className="font-medium">{operation.identity.name} · {operation.identity.kind === 'record' ? `Update ${operation.identity.key}` : `ERC-8004 ${operation.identity.kind}`}</p>{operation.identity.kind === 'record' && <p className="break-all">{operation.identity.value || '(clear record)'}</p>}<p className="text-xs text-ink-muted">Identity transaction on Ethereum Sepolia. No token amount is transferred; the agent pays gas under its existing limits.</p></div>}
        {operation.swap && <div className="mt-3 space-y-1 text-sm"><p className="font-medium">{operation.action === 'uniswap_approval' ? 'Uniswap · token allowance (fees only, not a transfer)' : 'Uniswap · maximum swap input shown above'}</p><p className="text-xs text-ink-muted">{operation.action === 'uniswap_approval' ? 'Exact-amount allowance for the vetted Base Sepolia SwapRouter02. The swap is a separate operation.' : `Minimum received: ${formatUnits(BigInt(operation.swap.minimumOutputAtomic), operation.swap.tokenOut === 'ETH' ? 18 : 6)} ${operation.swap.tokenOut}. Output returns to this agent’s wallet.`}</p>{operation.receipt?.swap && <p className="text-xs">Received: {formatUnits(BigInt(operation.receipt.swap.outputAtomic), operation.receipt.swap.tokenOut === 'ETH' ? 18 : 6)} {operation.receipt.swap.tokenOut}</p>}</div>}
        {operation.reason && <p className={layout('mt-4 break-words text-sm leading-relaxed', 'mt-4 break-words text-sm')}>{operation.reason}</p>}
        {paidRequest && <p className={`${layout('mt-4 flex flex-col items-start gap-2 leading-relaxed sm:flex-row sm:items-baseline sm:gap-3', 'mt-3')} break-all font-mono text-xs`}>
          <span className={layout('shrink-0 text-ink-muted', '')}>{operation.mpp ? 'MPP' : 'x402'} · {paidRequest.method ?? 'GET'}</span>{' '}
          <a href={paidRequest.url} target="_blank" rel="noopener noreferrer" className="min-w-0 underline underline-offset-4">{paidRequest.url}</a>
        </p>}
        {!!operation.mpp?.splits?.length && <div className="mt-3 text-xs"><p className="font-medium">Split payment · the total above includes all recipients</p><ul className="mt-2 space-y-2">{paymentTransfers(operation).map((transfer, index) => <li key={index} className="break-all"><span className="font-medium">{asset ? `${formatUnits(BigInt(transfer.amountAtomic), asset.decimals)} ${asset.symbol}` : `${transfer.amountAtomic} atomic units`}</span> → <span className="font-mono">{transfer.to}</span></li>)}</ul></div>}
        {operation.mpp?.mode === 'push' && <p className="mt-3 text-xs leading-relaxed text-ink-muted">Push payment · Agentis confirms the on-chain payment before sending its hash to the provider. Payment can settle even if the API request fails.</p>}
        {id && operation.mpp?.sponsored && <p className="mt-2 text-xs text-ink-muted">Provider sponsors network fees. This agent pays only the API charge.</p>}
        {id && requestDetails}
        {operation.httpResponse && <p className={layout('mt-3 text-xs leading-relaxed text-ink-muted', 'mt-3 text-sm')}>API response: HTTP {operation.httpResponse.status}. Payment settlement is tracked separately.</p>}
        {id && paidFee && <p className="mt-2 text-xs text-ink-muted">Network fee paid by agent: {formatUnits(BigInt(paidFee.amountAtomic), paidFee.decimals)} {paidFeeSymbol}</p>}
        <dl className={layout('mt-5 grid gap-x-8 gap-y-4 border-t border-beige-darker pt-4 text-sm sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr]', 'mt-5 grid gap-4 border-t border-beige-darker pt-5 text-sm sm:grid-cols-2')}>
          <div className={layout('min-w-0 sm:col-span-2 lg:col-span-1', 'sm:col-span-2')}>
            <dt className="mb-1.5 text-xs text-ink-muted">{operation.mpp?.splits?.length ? 'Primary recipient' : 'Recipient'}</dt>
            <dd className="break-all font-mono text-xs leading-relaxed">{operation.to}</dd>
          </div>
          <div className="min-w-0">
            <dt className="mb-1.5 text-xs text-ink-muted">{!id && paidFee ? 'Network fee paid by agent' : 'Maximum network fee'}</dt>
            <dd className="break-all">{!id && paidFee ? `${formatUnits(BigInt(paidFee.amountAtomic), paidFee.decimals)} ${paidFeeSymbol}` : !id && operation.mpp?.sponsored ? '0 · Provider-sponsored' : network ? `${formatUnits(BigInt(operation.maxFeeAtomic), network.decimals)} ${feeAsset?.symbol ?? network.currency}` : `${operation.maxFeeAtomic} atomic units`}</dd>
            {!id && paidFee && operation.mpp?.sponsored && <dd className="mt-1 text-xs text-ink-muted">Provider-sponsored</dd>}
          </div>
          {operation.usdReservedMicros != null && <div className="min-w-0">
            <dt className="mb-1.5 text-xs text-ink-muted">{operation.usdSettledMicros != null ? 'Budget charged' : 'USD spending ceiling · including fees'}</dt>
            <dd className="break-all">${formatUnits(BigInt(operation.usdSettledMicros ?? operation.usdReservedMicros), 6)}</dd>
            {id && operation.status === 'pending_approval' && <dd className="mt-2 text-xs leading-relaxed text-ink-muted">Token amount and maximum fee stay fixed. Price movement must fit within this USD ceiling; unused budget is released after settlement.</dd>}
          </div>}
        </dl>
        {operation.status === 'pending_approval' && <p className={`${layout('mt-[9px]', 'mt-4')} text-xs text-ink-muted`}>Approval expires {new Date(operation.expiresAt).toLocaleString()}.</p>}
        {(approving || processing) && <p role="status" className={`${layout('mt-[9px] text-xs', 'mt-4 text-sm')} flex items-center gap-2 text-ink`}><LoaderCircle size={id ? 16 : 14} className="motion-safe:animate-spin" aria-hidden="true" />{approving ? 'Approving payment…' : 'Processing transaction…'}</p>}
        {operation.status === 'unknown' && <p role="status" className={`border-l-2 border-accent ${layout('mt-[9px] pl-2 text-xs', 'mt-4 pl-3 text-sm')}`}>We’re checking whether this payment went through. Don’t send it again.</p>}
        {operation.error && <p className={layout('mt-4 break-words text-xs leading-relaxed text-ink-muted', 'mt-4 break-words text-sm')}>{operation.error}</p>}
        {operation.status === 'pending_approval' && <div className={`flex flex-wrap ${layout('mt-3 gap-2', 'mt-6 gap-3')}`}><button className={`bg-black ${layout('px-3 py-2', 'px-5 py-3')} font-mono text-xs uppercase tracking-widest text-beige disabled:opacity-40`} disabled={decision.isPending || !asset} onClick={() => decision.mutate({ operation, approve: true })}>{decision.isPending ? 'Working…' : 'Approve payment'}</button><button className={`border border-beige-darker ${layout('px-3 py-2', 'px-5 py-3')} font-mono text-xs uppercase tracking-widest disabled:opacity-40`} disabled={decision.isPending} onClick={() => decision.mutate({ operation, approve: false })}>Decline</button></div>}
        <div className={layout('mt-5 flex flex-wrap items-start gap-x-6 gap-y-3 border-t border-beige-darker pt-4', '')}>
          {explorer && <a href={explorer} target="_blank" rel="noreferrer" className={`inline-flex items-center underline underline-offset-4 ${layout('gap-1 text-xs', 'mt-5 gap-2 text-sm')}`}>View transaction <ArrowUpRight size={id ? 14 : 12} aria-hidden="true" /></a>}
          {!id && requestDetails}
          <details className={`text-xs text-ink-muted ${layout('min-w-0 max-w-full open:basis-full', 'mt-5 border-t border-beige-darker pt-4')}`}>
            <summary className="cursor-pointer">Technical details</summary>
            <p className="mt-3 break-all font-mono leading-relaxed">Payment ID: {operation.id}<br />Approval hash: {operation.operationHash}<br />Asset: {operation.asset}{!id && paidFee && <><br />Approved maximum network fee: {network ? `${formatUnits(BigInt(operation.maxFeeAtomic), network.decimals)} ${feeAsset?.symbol ?? network.currency}` : `${operation.maxFeeAtomic} atomic units`}</>}</p>
            {operation.receipt && <pre className="mt-3 max-h-64 overflow-auto">{JSON.stringify(operation.receipt, null, 2)}</pre>}
          </details>
        </div>
      </article>
    })}
    {!id && (filtered?.length ?? 0) > visibleCount && <button type="button" className="border border-beige-darker px-4 py-2 font-mono text-xs text-ink hover:bg-beige-dark" onClick={() => setVisibleCount(count => count + 10)}>Show more</button>}
  </section>
}
