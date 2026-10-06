'use client'
import { usePrivy } from '@privy-io/react-auth'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { type AgentisAgent } from '@agentis-hq/sdk'
import { useAgentisClient } from '@/lib/agentis'
import { formatUnits } from 'viem'
import AgentBalance from './AgentBalance'
import { Settings } from 'lucide-react'
import WalletAddresses from './WalletAddresses'
import Link from 'next/link'
import Dropdown from './Dropdown'
import PluginPicker from './PluginPicker'
import { pluginDetails } from './plugins/registry'
import { parseAmount } from './amount-input'

const labels = { perTransaction: 'Per transaction', hourly: 'Per hour', daily: 'Per day', total: 'Total budget' }
const defaults = { perTransaction: '10', hourly: '25', daily: '50', total: '100' }
const button = 'border border-beige-darker px-5 py-3 font-mono text-xs uppercase tracking-widest disabled:opacity-40 hover:border-ink'
const field = 'mt-2 w-full border border-beige-darker bg-[#faf7f1] p-3 text-sm'
export default function Onboarding({ agentId, createOnly = false }: { agentId?: string; createOnly?: boolean } = {}) {
  const { authenticated, user } = usePrivy()
  return authenticated && user ? <Setup key={user.id} ownerId={user.id} agentId={agentId} createOnly={createOnly} /> : null
}
function Setup({ ownerId, agentId, createOnly }: { ownerId: string; agentId?: string; createOnly: boolean }) {
  const cache = useQueryClient()
  const dialog = useRef<HTMLDialogElement>(null)
  const opened = useRef(false)
  const requestId = useRef('')
  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [step, setStep] = useState(0)
  const [reviewReached, setReviewReached] = useState(false)
  const canSave = editing !== null || reviewReached
  const [selected, setSelected] = useState<string[]>(['base'])
  const [enableTestnets, setEnableTestnets] = useState(false)
  const [plugins, setPlugins] = useState<AgentisAgent['plugins']>([])
  const [defaultNetwork, setDefaultNetwork] = useState('base')
  const [limits, setLimits] = useState(defaults)
  const [mode, setMode] = useState<AgentisAgent['mode']>('ask')
  const [recipients, setRecipients] = useState('')
  const [formError, setFormError] = useState('')
  const [finished, setFinished] = useState(false)
  const client = useAgentisClient()
  const query = useQuery({ queryKey: ['onboarding', ownerId], queryFn: () => client.onboarding.get() })
  const agents = useQuery({ queryKey: ['agents', ownerId], queryFn: () => client.agents.list() })
  const wallets = useQuery({ queryKey: ['wallets', ownerId], queryFn: () => client.wallets.list() })
  useEffect(() => { if (!agentId && !createOnly && agents.data?.length === 0 && !opened.current) { opened.current = true; requestId.current = crypto.randomUUID(); dialog.current?.showModal() } }, [agents.data, agentId, createOnly])
  const save = useMutation({ mutationFn: () => {
    const input = { plugins, name: name.trim(), selection: { networks: selected, defaultNetwork }, limits: Object.fromEntries(Object.entries(limits).map(([key, value]) => [key, value.trim() ? formatUnits(parseAmount(value.trim(), 6), 6) : null])) as AgentisAgent['limits'], mode, allowedRecipients: recipients.trim() ? recipients.trim().split(/[\s,]+/) : [] }
    return editing ? client.agents.update(editing, { ...input, enableExecution: name.trim() === agents.data?.find(agent => agent.id === editing)?.name && JSON.stringify(plugins) === JSON.stringify(agents.data?.find(agent => agent.id === editing)?.plugins) }) : client.agents.create({ ...input, id: requestId.current })
  }, onSuccess: async () => { setFinished(true); await Promise.all(['agents', 'wallets', 'onboarding', 'operations', 'profile', 'agent-balances'].map(key => cache.invalidateQueries({ queryKey: [key] }))) } })
  function open(agent?: AgentisAgent) {
    requestId.current = agent?.id ?? crypto.randomUUID()
    setEditing(agent?.id ?? null); setName(agent?.name ?? ''); setPlugins(agent?.plugins ?? [])
    setSelected(agent?.networks ?? ['base']); setDefaultNetwork(agent?.defaultNetwork ?? 'base')
    setEnableTestnets(Boolean(query.data?.networks.some(network => network.testnet && agent?.networks.includes(network.key))))
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
    if (!validate(step >= 1)) return
    if (step === 2) setReviewReached(true)
    setStep(value => Math.min(value + 1, 3))
  }
  return <section className="space-y-5">
    {agentId ? <button className="bg-black px-5 py-2.5 font-mono text-xs tracking-widest text-white hover:bg-ink disabled:opacity-40" disabled={!query.data || !agents.data?.some(agent => agent.id === agentId)} onClick={() => open(agents.data?.find(agent => agent.id === agentId))}>Settings</button> : <div className="flex flex-wrap items-center justify-between gap-4">{!createOnly && <div><h2 className="font-serif text-3xl font-bold">Your agents</h2><p className="mt-2 text-sm text-ink-muted">Separate wallets, budgets and rules for each agent.</p></div>}<button className="bg-black px-5 py-2.5 font-mono text-xs tracking-widest text-beige hover:bg-ink disabled:opacity-40" disabled={!query.data || !agents.data} onClick={() => open()}><span aria-hidden="true">+ </span>create agent</button></div>}
    {(query.error || agents.error || wallets.error) && <p role="alert">{query.error?.message ?? agents.error?.message ?? wallets.error?.message}</p>}
    {!agentId && !createOnly && <div className="grid gap-5 md:grid-cols-2">{agents.data?.map(agent => <article key={agent.id} className="relative flex flex-col border border-beige-darker bg-[#faf7f1] p-6 transition-colors hover:border-ink-muted"><div className="flex items-start justify-between gap-4"><h3 className="break-words font-serif text-2xl font-bold"><Link href={`/dashboard/agents/${agent.id}`} className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ink">{agent.name}</Link></h3><span className="shrink-0 font-mono text-[10px] uppercase text-ink-muted">{agent.mode === 'paused' ? 'Paused' : agent.mode === 'automatic' ? 'Auto-approve' : 'Approval required'}</span></div><AgentBalance agentId={agent.id} /><dl className="my-5 grid grid-cols-2 gap-4">{Object.entries(labels).map(([key, label]) => <div key={key}><dt className="text-xs text-ink-muted">{label}</dt><dd className="mt-1 font-mono text-sm">{agent.limits[key as keyof typeof labels] === null ? 'No cap' : `$${agent.limits[key as keyof typeof labels]}`}</dd></div>)}</dl><div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 border-t border-beige-darker pt-4 [&:has(details[open])>div]:h-4"><details className="relative z-10 min-w-0 text-sm"><summary className="cursor-pointer">Wallet addresses</summary><WalletAddresses wallets={wallets.data?.filter(wallet => wallet.agentId === agent.id) ?? []} networks={query.data?.networks ?? []} compact /></details><div className="relative z-10 flex h-5 items-center"><button type="button" aria-label={`Edit rules for ${agent.name}`}  title="Agent settings" className="relative z-10 p-1.5 text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2" onClick={() => open(agent)}><Settings size={14} aria-hidden="true" /></button></div></div>{wallets.data?.some(wallet => wallet.agentId === agent.id && wallet.enabled && !wallet.serverAuthorized) && <p className="mb-4 text-sm text-ink-muted">One-time setup needed: open settings and save to enable backend execution. Your addresses and funds stay unchanged.</p>}</article>)}</div>}
    <dialog ref={dialog} aria-labelledby="setup-title" onCancel={event => { if (save.isPending) event.preventDefault() }} onClick={event => {
      if (save.isPending || event.target !== event.currentTarget) return
      const bounds = event.currentTarget.getBoundingClientRect()
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close()
    }} className="fixed inset-0 m-auto h-[min(800px,90dvh)] max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-2xl overflow-hidden border border-beige-darker bg-beige p-0 text-ink shadow-xl backdrop:bg-black/50">
      <div className="flex h-full flex-col p-6 sm:p-9"><header className="flex shrink-0 items-start justify-between gap-4"><div><p className="font-mono text-xs uppercase tracking-widest text-ink-muted">{editing ? 'Agent settings' : 'New agent'}</p><h2 id="setup-title" className="mt-3 font-serif text-3xl font-bold">{finished ? `${name} is ready.` : editing ? `Configure ${name}` : 'Create your agent.'}</h2></div><button aria-label="Close setup" className="p-2 text-2xl" disabled={save.isPending} onClick={() => dialog.current?.close()}>×</button></header>
      {!finished && <ol aria-label="Setup progress" className="my-7 grid shrink-0 grid-cols-4 gap-2">{['Agent', 'Rules', 'Plugins', 'Review'].map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined} className={`font-mono text-xs uppercase ${index <= step ? 'border-black' : 'border-beige-darker text-ink-muted'}`}>{canSave ? <button type="button" disabled={save.isPending} onClick={() => { setFormError(''); setStep(index) }} className="block w-full border-t-2 border-inherit pt-3 text-left uppercase hover:underline disabled:opacity-40">0{index + 1} · {label}</button> : <span className="block border-t-2 border-inherit pt-3">0{index + 1} · {label}</span>}</li>)}</ol>}
      <div className="min-h-0 flex-1 overflow-y-auto pr-3 [scrollbar-color:#b5a995_#f5f0e8] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-beige [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#b5a995] [&::-webkit-scrollbar-thumb:hover]:bg-ink-muted">
      {!finished && step === 0 && <div className="space-y-4"><label className="block text-sm">Agent name<input className={field} value={name} maxLength={80} placeholder="Research agent" onChange={event => setName(event.target.value)} /></label><p className="text-sm text-ink-muted">Choose this agent’s networks. Other agents keep their own wallets.</p><label className="flex items-center justify-between gap-3 py-2 text-sm"><span>Enable testnets</span><input type="checkbox" className="accent-black" checked={enableTestnets} onChange={event => { const enabled = event.target.checked; setEnableTestnets(enabled); if (!enabled) { const next = selected.filter(key => query.data?.networks.some(network => network.key === key && !network.testnet)); setSelected(next); if (!next.includes(defaultNetwork)) setDefaultNetwork(next[0] ?? 'base') } }} /></label>{query.data?.networks.filter(network => enableTestnets || !network.testnet).map(network => <label key={network.key} className="flex cursor-pointer items-center gap-3 border border-beige-darker p-3"><input type="checkbox" className="accent-black" checked={selected.includes(network.key)} onChange={event => { const next = event.target.checked ? [...selected, network.key] : selected.filter(key => key !== network.key); setSelected(next); if (!next.includes(defaultNetwork)) setDefaultNetwork(next[0] ?? 'base') }} /><span className="flex-1 font-serif text-lg font-bold">{network.name}</span><span className="text-xs text-ink-muted">{network.testnet ? 'Testnet' : 'Mainnet'}</span></label>)}<Dropdown label="Default network" className="text-sm" value={defaultNetwork} onChange={setDefaultNetwork} disabled={save.isPending} options={query.data?.networks.filter(network => selected.includes(network.key)).map(network => ({ value: network.key, label: network.name })) ?? []} /></div>}
      {!finished && step === 1 && <div className="space-y-5"><p className="text-sm text-ink-muted">USD limits apply across this agent’s networks, including fees. Testnets have a separate allowance with the same limits.</p><div className="grid gap-4 sm:grid-cols-2">{Object.entries(labels).map(([key, label]) => <label className="text-sm" key={key}>{label} · USD<input className={field} inputMode="decimal" placeholder="No cap" value={limits[key as keyof typeof limits]} onChange={event => setLimits({ ...limits, [key]: event.target.value })} /></label>)}</div><p className="text-xs text-ink-muted">Hourly and daily limits use rolling windows. Total doesn’t reset. Leave a field blank for no cap; zero blocks spending.</p><Dropdown label="Payment approvals" className="text-sm" value={mode} onChange={value => setMode(value as typeof mode)} disabled={save.isPending} options={[{ value: 'ask', label: 'Approve every payment' }, { value: 'automatic', label: 'Auto-approve within my limits' }, { value: 'paused', label: 'Paused — no payments' }]} /><label className="block text-sm">Allowed recipients<textarea className={field} rows={3} placeholder="Any recipient, or enter allowed addresses (one per line)" value={recipients} onChange={event => setRecipients(event.target.value)} /></label></div>}
      {!finished && step === 2 && <PluginPicker selected={plugins} onChange={setPlugins} disabled={save.isPending} />}
      {!finished && step === 3 && <div className="space-y-4"><h3 className="font-serif text-2xl font-bold">{name}</h3><p className="text-sm">{query.data?.networks.filter(network => selected.includes(network.key)).map(network => network.name).join(', ')}</p><p className="text-sm">Plugins: {plugins.length ? plugins.map(plugin => pluginDetails(plugin).name).join(', ') : 'None'}</p><dl className="divide-y divide-beige-darker">{Object.entries(labels).map(([key, label]) => <div key={key} className="flex justify-between py-3 text-sm"><dt>{label}</dt><dd>{limits[key as keyof typeof limits].trim() ? `$${limits[key as keyof typeof limits]}` : 'No cap'}</dd></div>)}<div className="flex justify-between py-3 text-sm"><dt>Payments</dt><dd>{mode === 'paused' ? 'Paused' : mode === 'automatic' ? 'Auto-approve within limits' : 'Your approval required'}</dd></div></dl><p className="text-sm text-ink-muted">{recipients.trim() ? 'Only the recipients you listed are allowed.' : 'Any recipient is allowed.'}</p></div>}
      {finished && <div className="my-7 space-y-4"><p className="text-sm text-ink-muted">{editing ? 'Rules saved.' : 'Fund these wallets to start making payments.'}</p><WalletAddresses wallets={wallets.data?.filter(wallet => wallet.agentId === save.data?.id) ?? []} networks={query.data?.networks ?? []} /></div>}
      {(formError || save.error) && <p role="alert" className="mt-5 text-sm">{formError || save.error?.message}</p>}
      </div>
      <footer className="mt-7 flex shrink-0 justify-between gap-4 border-t border-beige-darker pt-5">{finished ? <button className={`${button} ml-auto bg-black text-beige`} onClick={() => dialog.current?.close()}>Done</button> : <><button className={button} disabled={step === 0 || save.isPending} onClick={() => { setFormError(''); setStep(value => value - 1) }}>Back</button><div className="flex flex-wrap justify-end gap-2">{step < 3 && <button className={`${button} ${canSave ? '' : 'bg-black text-beige'}`} disabled={save.isPending} onClick={next}>Next</button>}{canSave && <button className={`${button} bg-black text-beige`} disabled={save.isPending} onClick={() => { if (validate()) save.mutate() }}>{save.isPending ? 'Saving…' : 'Save'}</button>}</div></>}</footer>
      </div>
    </dialog>
  </section>
}
