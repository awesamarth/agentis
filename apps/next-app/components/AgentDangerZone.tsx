'use client'

import { useEffect, useRef, useState } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { useQueryClient } from '@tanstack/react-query'
import { AgentisClient, type AgentisAgent, type AgentisWallet } from '@agentis-hq/sdk'
import Dropdown from './Dropdown'

export default function AgentDangerZone({ agent, wallets, networks }: { agent: AgentisAgent; wallets: AgentisWallet[]; networks: { chainId: string; name: string }[] }) {
  const { getAccessToken } = usePrivy()
  const cache = useQueryClient()
  const dialog = useRef<HTMLDialogElement>(null)
  const [action, setAction] = useState<'pause' | 'export'>('pause')
  const [walletId, setWalletId] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [privateKey, setPrivateKey] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const selected = wallets.find(wallet => wallet.id === walletId)
  const button = 'px-4 py-2.5 font-mono text-xs tracking-widest disabled:opacity-40'
  useEffect(() => {
    function hide() { if (document.hidden) { setPrivateKey(''); setCopied(false) } }
    document.addEventListener('visibilitychange', hide)
    return () => document.removeEventListener('visibilitychange', hide)
  }, [])
  function open(next: typeof action) {
    setAction(next); setConfirmed(false); setError(''); setPrivateKey(''); setCopied(false)
    setWalletId(wallets[0]?.id ?? ''); dialog.current?.showModal()
  }
  async function submit() {
    if (!confirmed || busy || (action === 'export' && !selected)) return
    setBusy(true); setError('')
    const client = new AgentisClient({ baseUrl: process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001', token: async () => { const token = await getAccessToken(); if (!token) throw new Error('Sign in again to continue'); return token } })
    try {
      if (action === 'pause') {
        await client.agents.pause(agent.id)
        await Promise.all(['agents', 'wallets', 'operations', 'profile'].map(key => cache.invalidateQueries({ queryKey: [key] })))
        dialog.current?.close()
      } else {
        // Never put private keys into React Query, browser storage, or automatic clipboard writes.
        const result = await client.wallets.exportKey(selected!.id, { confirm: true })
        if (dialog.current?.open && !document.hidden) setPrivateKey(result.privateKey)
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Request failed. Please try again.') }
    finally { setBusy(false) }
  }
  return <section className="border-t border-beige-darker pt-8">
    <h2 className="mb-4 font-mono text-[0.6rem] uppercase tracking-widest text-ink-muted">Danger zone</h2>
    <div className="divide-y divide-beige-darker border border-beige-darker bg-white px-5">
      <div className="flex flex-wrap items-center justify-between gap-4 py-5"><div className="max-w-lg"><h3 className="font-serif text-lg font-bold">Pause agent</h3><p className="mt-1 text-sm text-ink-muted">Stop payments across this agent’s networks. Already-signed or submitted payments cannot be recalled. Resume from Settings.</p></div><button className={`${button} bg-red-700 text-white hover:bg-red-800`} disabled={agent.mode === 'paused'} onClick={() => open('pause')}>{agent.mode === 'paused' ? 'Paused' : 'Pause agent'}</button></div>
      <div className="flex flex-wrap items-center justify-between gap-4 py-5"><div className="max-w-lg"><h3 className="font-serif text-lg font-bold">Export private key</h3><p className="mt-1 text-sm text-ink-muted">Anyone with the key can move funds outside Agentis rules—even while this agent is paused.</p></div><button className={`${button} border border-red-700 text-red-700 hover:bg-red-50`} disabled={!wallets.length} onClick={() => open('export')}>Export private key</button></div>
    </div>
    <dialog ref={dialog} aria-labelledby="agent-danger-title" onClose={() => { setPrivateKey(''); setCopied(false); setConfirmed(false); setError('') }} onCancel={event => { if (busy) event.preventDefault() }} className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto border border-beige-darker bg-beige p-6 text-ink shadow-xl backdrop:bg-black/50 sm:p-8">
      <h2 id="agent-danger-title" className="font-serif text-2xl font-bold">{action === 'pause' ? `Pause ${agent.name}?` : 'Export private key?'}</h2>
      {action === 'pause' ? <p className="mt-4 text-sm text-ink-muted">This blocks new Agentis payments and cancels pending approvals and queued payments across all of this agent’s networks. Already-signed or submitted payments may still settle. Other agents are unaffected.</p> : <div className="mt-4 space-y-4 text-sm">
        <p className="text-ink-muted">Keep this key secure. Never share it or paste it into chats. Anyone with it can control the wallet without Agentis limits or approvals. The same key may control this address on multiple networks.</p>
        <Dropdown label="Wallet network" value={walletId} disabled={busy || !!privateKey} onChange={value => { setWalletId(value); setConfirmed(false); setError('') }} options={wallets.map(wallet => ({ value: wallet.id, label: networks.find(network => network.chainId === wallet.chainId)?.name ?? wallet.chainId }))} />
        {selected && <p className="break-all font-mono text-xs text-ink-muted">{selected.address}</p>}
        {privateKey && <div className="space-y-3"><label className="block text-xs">Private key<textarea aria-label="Private key" readOnly autoComplete="off" spellCheck={false} value={privateKey} className="mt-2 w-full break-all border border-beige-darker bg-[#faf7f1] p-3 font-mono text-xs" /></label><button className="font-mono text-xs underline" onClick={async () => { try { await navigator.clipboard.writeText(privateKey); setCopied(true) } catch { setError('Could not copy. Select the key to copy it manually.') } }}>{copied ? 'Copied' : 'Copy private key'}</button><p className="text-xs text-ink-muted">Hidden when you close this dialog or switch tabs. Clear your clipboard after use.</p></div>}
      </div>}
      {!privateKey && <label className="mt-5 flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 accent-black" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} /><span>{action === 'pause' ? 'I understand and want to pause this agent.' : 'I understand the risks and want to reveal this wallet’s private key.'}</span></label>}
      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
      <footer className="mt-6 flex justify-end gap-3 border-t border-beige-darker pt-5"><button className={`${button} border border-beige-darker hover:border-ink`} disabled={busy} onClick={() => dialog.current?.close()}>{privateKey ? 'Done' : 'Cancel'}</button>{!privateKey && <button disabled={!confirmed || busy || (action === 'export' && !selected)} className={`${button} bg-red-700 text-white hover:bg-red-800`} onClick={submit}>{busy ? 'Working…' : action === 'pause' ? 'Pause agent' : 'Reveal private key'}</button>}</footer>
    </dialog>
  </section>
}
