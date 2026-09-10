'use client'
import { usePrivy } from '@privy-io/react-auth'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { AgentisClient, type AgentisAgent } from '@agentis-hq/sdk'
import { formatUnits } from 'viem'
import { Copy, Check, Settings } from 'lucide-react'
import Link from 'next/link'
import Dropdown from './Dropdown'
import { parseAmount } from './amount-input'

const labels = { perTransaction: 'Per transaction', hourly: 'Per hour', daily: 'Per day', total: 'Total budget' }
const defaults = { perTransaction: '10', hourly: '25', daily: '50', total: '100' }
const button = 'border border-beige-darker px-5 py-3 font-mono text-xs uppercase tracking-widest disabled:opacity-40 hover:border-ink'
const field = 'mt-2 w-full border border-beige-darker bg-[#faf7f1] p-3 text-sm'
export default function Onboarding() {
  const { authenticated, user, getAccessToken } = usePrivy()
  return authenticated && user ? <Setup key={user.id} ownerId={user.id} getAccessToken={getAccessToken} /> : null
}
export function WalletAddress({ address }: { address: string }) {
  const [status, setStatus] = useState('')
  async function copy() {
    try { await navigator.clipboard.writeText(address); setStatus('Copied') }
    catch { setStatus('Couldn’t copy. Select the address to copy manually.') }
  }
  return <div className="mt-1"><div className="flex items-center gap-1"><p className="min-w-0 break-all font-mono text-xs">{address}</p><button type="button" onClick={copy} onBlur={() => setStatus('')} aria-label="Copy wallet address" title={status === 'Copied' ? 'Copied' : 'Copy address'} className="shrink-0 rounded p-0.5 text-ink-muted hover:bg-beige-dark hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2">{status === 'Copied' ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}</button></div><p role="status" className={status === 'Copied' ? 'sr-only' : 'text-xs text-ink-muted'}>{status}</p></div>
}
function Setup({ ownerId, getAccessToken }: { ownerId: string; getAccessToken: () => Promise<string | null> }) {
  const cache = useQueryClient()
  const dialog = useRef<HTMLDialogElement>(null)
  const opened = useRef(false)
  const requestId = useRef('')
  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [step, setStep] = useState(0)
  const [reviewReached, setReviewReached] = useState(false)
  const canSave = editing !== null || reviewReached
  const [selected, setSelected] = useState<string[]>(['base', 'arc', 'tempo', 'solana'])
  const [defaultNetwork, setDefaultNetwork] = useState('base')
  const [limits, setLimits] = useState(defaults)
  const [mode, setMode] = useState<AgentisAgent['mode']>('ask')
  const [recipients, setRecipients] = useState('')
  const [formError, setFormError] = useState('')
  const [finished, setFinished] = useState(false)
  const client = new AgentisClient({ baseUrl: process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001', token: async () => { const token = await getAccessToken(); if (!token) throw new Error('Sign in again'); return token } })
  const query = useQuery({ queryKey: ['onboarding', ownerId], queryFn: () => client.onboarding.get() })
  const agents = useQuery({ queryKey: ['agents', ownerId], queryFn: () => client.agents.list() })
  const wallets = useQuery({ queryKey: ['wallets', ownerId], queryFn: () => client.wallets.list() })
  useEffect(() => { if (agents.data?.length === 0 && !opened.current) { opened.current = true; requestId.current = crypto.randomUUID(); dialog.current?.showModal() } }, [agents.data])
  const save = useMutation({ mutationFn: () => {
    const input = { name: name.trim(), selection: { networks: selected, defaultNetwork }, limits: Object.fromEntries(Object.entries(limits).map(([key, value]) => [key, value.trim() ? formatUnits(parseAmount(value.trim(), 6), 6) : null])) as AgentisAgent['limits'], mode, allowedRecipients: recipients.trim() ? recipients.trim().split(/[\s,]+/) : [] }
    return editing ? client.agents.update(editing, { ...input, enableExecution: name.trim() === agents.data?.find(agent => agent.id === editing)?.name }) : client.agents.create({ ...input, id: requestId.current })
  }, onSuccess: async () => { setFinished(true); await Promise.all(['agents', 'wallets', 'onboarding', 'operations', 'profile'].map(key => cache.invalidateQueries({ queryKey: [key] }))) } })
  function open(agent?: AgentisAgent) {
    requestId.current = agent?.id ?? crypto.randomUUID()
    setEditing(agent?.id ?? null); setName(agent?.name ?? '')
    setSelected(agent?.networks ?? ['base', 'arc', 'tempo', 'solana']); setDefaultNetwork(agent?.defaultNetwork ?? 'base')
    setLimits(agent ? Object.fromEntries(Object.entries(agent.limits).map(([key, value]) => [key, value ?? ''])) as typeof defaults : defaults)
    setMode(agent?.mode ?? 'ask'); setRecipients(agent?.allowedRecipients.join('\n') ?? '')
    setStep(0); setReviewReached(false); setFinished(false); setFormError(''); save.reset(); dialog.current?.showModal()
  }
  function validate(checkLimits = true) {
    if (!name.trim()) { setFormError('Give your agent a name.'); return false }
    if (!selected.length) { setFormError('Choose at least one network.'); return false }
    try { if (checkLimits) for (const value of Object.values(limits)) if (value.trim()) parseAmount(value.trim(), 6) } catch { setFormError('Enter valid USD amounts.'); return false }
    setFormError(''); return true
  }
  function next() {
    if (!validate(step === 1)) return
    if (step === 1) setReviewReached(true)
    setStep(value => Math.min(value + 1, 2))
  }
  return <section className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="font-serif text-3xl font-bold">Your agents</h2><p className="mt-2 text-sm text-ink-muted">Separate wallets, budgets and rules for each agent.</p></div><button className="bg-black px-5 py-2.5 font-mono text-xs tracking-widest text-beige hover:bg-ink disabled:opacity-40" disabled={!query.data || !agents.data} onClick={() => open()}><span aria-hidden="true">+ </span>create agent</button></div>
    {(query.error || agents.error || wallets.error) && <p role="alert">{query.error?.message ?? agents.error?.message ?? wallets.error?.message}</p>}
    <div className="grid gap-5 md:grid-cols-2">{agents.data?.map(agent => <article key={agent.id} className="relative flex flex-col border border-beige-darker bg-[#faf7f1] p-6 transition-colors hover:border-ink-muted"><div className="flex items-start justify-between gap-4"><h3 className="break-words font-serif text-2xl font-bold"><Link href={`/dashboard/agents/${agent.id}`} className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ink">{agent.name}</Link></h3><span className="shrink-0 font-mono text-[10px] uppercase text-ink-muted">{agent.mode === 'paused' ? 'Paused' : agent.mode === 'automatic' ? 'Auto-approve' : 'Approval required'}</span></div><dl className="my-5 grid grid-cols-2 gap-4">{Object.entries(labels).map(([key, label]) => <div key={key}><dt className="text-xs text-ink-muted">{label}</dt><dd className="mt-1 font-mono text-sm">{agent.limits[key as keyof typeof labels] === null ? 'No cap' : `$${agent.limits[key as keyof typeof labels]}`}</dd></div>)}</dl><div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 border-t border-beige-darker pt-4 [&:has(details[open])>div]:h-4"><details className="relative z-10 min-w-0 text-sm"><summary className="cursor-pointer">Wallet addresses</summary>{wallets.data?.filter(wallet => wallet.agentId === agent.id).map(wallet => <div className="mt-3" key={wallet.id}><p className="text-xs text-ink-muted">{query.data?.networks.find(network => network.chainId === wallet.chainId)?.name}{!wallet.enabled ? ' · Disabled' : ''}</p><WalletAddress address={wallet.address} /></div>)}</details><div className="relative z-10 flex h-5 items-center"><button type="button" aria-label={`Edit rules for ${agent.name}`}  title="Agent settings" className="relative z-10 p-1.5 text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2" onClick={() => open(agent)}><Settings size={14} aria-hidden="true" /></button></div></div>{wallets.data?.some(wallet => wallet.agentId === agent.id && wallet.enabled && !wallet.serverAuthorized) && <p className="mb-4 text-sm text-ink-muted">One-time setup needed: open settings and save to enable backend execution. Your addresses and funds stay unchanged.</p>}</article>)}</div>
    <dialog ref={dialog} aria-labelledby="setup-title" onCancel={event => { if (save.isPending) event.preventDefault() }} onClick={event => {
      if (save.isPending || event.target !== event.currentTarget) return
      const bounds = event.currentTarget.getBoundingClientRect()
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close()
    }} className="fixed inset-0 m-auto h-[min(800px,90dvh)] max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-2xl overflow-hidden border border-beige-darker bg-beige p-0 text-ink shadow-xl backdrop:bg-black/50">
      <div className="flex h-full flex-col p-6 sm:p-9"><header className="flex shrink-0 items-start justify-between gap-4"><div><p className="font-mono text-xs uppercase tracking-widest text-ink-muted">{editing ? 'Agent settings' : 'New agent'}</p><h2 id="setup-title" className="mt-3 font-serif text-3xl font-bold">{finished ? `${name} is ready.` : editing ? `Configure ${name}` : 'Create your agent.'}</h2></div><button aria-label="Close setup" className="p-2 text-2xl" disabled={save.isPending} onClick={() => dialog.current?.close()}>×</button></header>
      {!finished && <ol aria-label="Setup progress" className="my-7 grid shrink-0 grid-cols-3 gap-3">{['Agent', 'Rules', 'Review'].map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined} className={`border-t-2 pt-3 font-mono text-xs uppercase ${index <= step ? 'border-black' : 'border-beige-darker text-ink-muted'}`}>{canSave ? <button type="button" disabled={save.isPending} onClick={() => { setFormError(''); setStep(index) }} className="w-full text-left uppercase hover:underline disabled:opacity-40">0{index + 1} · {label}</button> : <>0{index + 1} · {label}</>}</li>)}</ol>}
      <div className="min-h-0 flex-1 overflow-y-auto">
      {!finished && step === 0 && <div className="space-y-4"><label className="block text-sm">Agent name<input className={field} value={name} maxLength={80} placeholder="Research agent" onChange={event => setName(event.target.value)} /></label><p className="text-sm text-ink-muted">Choose this agent’s networks. Other agents keep their own wallets.</p>{query.data?.networks.map(network => <label key={network.key} className="flex cursor-pointer items-center gap-3 border border-beige-darker p-3"><input type="checkbox" className="accent-black" checked={selected.includes(network.key)} onChange={event => { const next = event.target.checked ? [...selected, network.key] : selected.filter(key => key !== network.key); setSelected(next); if (!next.includes(defaultNetwork)) setDefaultNetwork(next[0] ?? 'base') }} /><span className="flex-1 font-serif text-lg font-bold">{network.name}</span><span className="text-xs text-ink-muted">{network.testnet ? 'Testnet' : 'Mainnet'}</span></label>)}<Dropdown label="Default network" className="text-sm" value={defaultNetwork} onChange={setDefaultNetwork} disabled={save.isPending} options={query.data?.networks.filter(network => selected.includes(network.key)).map(network => ({ value: network.key, label: network.name })) ?? []} /></div>}
      {!finished && step === 1 && <div className="space-y-5"><p className="text-sm text-ink-muted">USD limits apply only to this agent, across its networks, including fees.</p><div className="grid gap-4 sm:grid-cols-2">{Object.entries(labels).map(([key, label]) => <label className="text-sm" key={key}>{label} · USD<input className={field} inputMode="decimal" placeholder="No cap" value={limits[key as keyof typeof limits]} onChange={event => setLimits({ ...limits, [key]: event.target.value })} /></label>)}</div><p className="text-xs text-ink-muted">Hourly and daily limits use rolling windows. Total doesn’t reset. Leave a field blank for no cap; zero blocks spending.</p><Dropdown label="Payment approvals" className="text-sm" value={mode} onChange={value => setMode(value as typeof mode)} disabled={save.isPending} options={[{ value: 'ask', label: 'Approve every payment' }, { value: 'automatic', label: 'Auto-approve within my limits' }, { value: 'paused', label: 'Paused — no payments' }]} /><label className="block text-sm">Allowed recipients<textarea className={field} rows={3} placeholder="Any recipient, or enter allowed addresses (one per line)" value={recipients} onChange={event => setRecipients(event.target.value)} /></label></div>}
      {!finished && step === 2 && <div className="space-y-4"><h3 className="font-serif text-2xl font-bold">{name}</h3><p className="text-sm">{query.data?.networks.filter(network => selected.includes(network.key)).map(network => network.name).join(', ')}</p><dl className="divide-y divide-beige-darker">{Object.entries(labels).map(([key, label]) => <div key={key} className="flex justify-between py-3 text-sm"><dt>{label}</dt><dd>{limits[key as keyof typeof limits].trim() ? `$${limits[key as keyof typeof limits]}` : 'No cap'}</dd></div>)}<div className="flex justify-between py-3 text-sm"><dt>Payments</dt><dd>{mode === 'paused' ? 'Paused' : mode === 'automatic' ? 'Auto-approve within limits' : 'Your approval required'}</dd></div></dl><p className="text-sm text-ink-muted">{recipients.trim() ? 'Only the recipients you listed are allowed.' : 'Any recipient is allowed.'}</p></div>}
      {finished && <div className="my-7 space-y-4"><p className="text-sm text-ink-muted">{editing ? 'Rules saved.' : 'Fund these wallets to start making payments.'}</p>{wallets.data?.filter(wallet => wallet.agentId === save.data?.id && wallet.enabled).map(wallet => <div key={wallet.id} className="border border-beige-darker p-4"><p className="font-serif text-lg font-bold">{query.data?.networks.find(network => network.chainId === wallet.chainId)?.name}</p><WalletAddress address={wallet.address} /></div>)}</div>}
      {(formError || save.error) && <p role="alert" className="mt-5 text-sm">{formError || save.error?.message}</p>}
      </div>
      <footer className="mt-7 flex shrink-0 justify-between gap-4 border-t border-beige-darker pt-5">{finished ? <button className={`${button} ml-auto bg-black text-beige`} onClick={() => dialog.current?.close()}>Done</button> : <><button className={button} disabled={step === 0 || save.isPending} onClick={() => { setFormError(''); setStep(value => value - 1) }}>Back</button><div className="flex flex-wrap justify-end gap-2">{step < 2 && <button className={`${button} ${canSave ? '' : 'bg-black text-beige'}`} disabled={save.isPending} onClick={next}>Next</button>}{canSave && <button className={`${button} bg-black text-beige`} disabled={save.isPending} onClick={() => { if (validate()) save.mutate() }}>{save.isPending ? 'Saving…' : 'Save'}</button>}</div></>}</footer>
      </div>
    </dialog>
  </section>
}
