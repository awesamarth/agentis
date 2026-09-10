'use client'

import { useState } from 'react'
import { useCreateWallet, useExportWallet, usePrivy } from '@privy-io/react-auth'

export default function TestPage() {
  const { ready, authenticated, user, login } = usePrivy()
  const { createWallet } = useCreateWallet()
  const { exportWallet } = useExportWallet()
  const [wallet, setWallet] = useState<{ address: string; owner: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const selected = wallet?.owner === user?.id ? wallet : null
  async function create() {
    if (!user || busy) return
    setBusy(true); setError(''); setStatus('Creating a new wallet in Privy…')
    try {
      const hasWallet = user.linkedAccounts.some(account => account.type === 'wallet' && account.walletClientType === 'privy' && account.chainType === 'ethereum')
      const created = await createWallet({ createAdditional: hasWallet })
      setWallet({ address: created.address, owner: user.id })
      setStatus('New wallet created. No Agentis record was created.')
    } catch (cause) { setStatus(''); setError(`Create failed: ${cause instanceof Error ? cause.message : 'Unknown Privy error'}`) }
    finally { setBusy(false) }
  }
  async function exportKey() {
    if (!selected || busy) return
    setBusy(true); setError(''); setStatus('Opening Privy’s export dialog…')
    try {
      await exportWallet({ address: selected.address })
      setStatus('Privy export dialog closed.')
    } catch (cause) { setStatus(''); setError(`Export failed: ${cause instanceof Error ? cause.message : 'Unknown Privy error'}`) }
    finally { setBusy(false) }
  }
  return <main className="mx-auto max-w-xl space-y-6 px-6 py-12">
    <h1 className="font-serif text-3xl font-bold">Privy wallet test</h1>
    <p className="text-sm text-ink-muted">Create a new, unfunded Ethereum wallet in Privy, then export that wallet using Privy’s own dialog. No Agentis backend, agents, database records, or server quorum setup.</p>
    {!authenticated && <button disabled={!ready} onClick={() => login()} className="bg-black px-5 py-3 font-mono text-xs text-white disabled:opacity-40">Sign in to Privy</button>}
    <div className="flex flex-wrap gap-3">
      <button disabled={!ready || !authenticated || busy || !!selected} onClick={create} className="bg-black px-5 py-3 font-mono text-xs text-white disabled:opacity-40">1. Create new wallet</button>
      <button disabled={!authenticated || busy || !selected} onClick={exportKey} className="bg-black px-5 py-3 font-mono text-xs text-white disabled:opacity-40">2. Export key</button>
    </div>
    {selected && <p className="break-all border border-beige-darker bg-[#faf7f1] p-4 font-mono text-xs">{selected.address}</p>}
    {status && <p role="status" className="text-sm">{status}</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <p className="text-xs text-ink-muted">Keep it unfunded. Private keys stay in Privy’s export dialog; this page does not read or store them. This tests the browser SDK independently of the failing server JWT exchange.</p>
  </main>
}
