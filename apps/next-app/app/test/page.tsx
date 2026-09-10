'use client'

import { useEffect, useRef, useState } from 'react'
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
    <QuorumWalletTest />
    <TokenComparison />
  </main>
}

function TokenComparison() {
  const { authenticated, getAccessToken } = usePrivy()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  async function compare() {
    if (!authenticated || busy) return
    setBusy(true); setResult(''); setError('')
    try {
      const customer = await getAccessToken()
      if (!customer) throw new Error('Sign in first')
      // Diagnostic only: this is SDK-internal storage, not a supported production token API.
      const stored = localStorage.getItem('privy:pat')
      let privyToken: string | null = null
      if (stored) {
        let parsed: unknown
        try { parsed = JSON.parse(stored) } catch { parsed = stored }
        if (typeof parsed !== 'string') throw new Error('Internal token storage format is not a string')
        privyToken = parsed
      }
      const response = await fetch(`${(process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001').replace(/\/$/, '')}/v1/test/privy-token-comparison`, { method: 'POST', headers: { authorization: `Bearer ${customer}`, 'content-type': 'application/json' }, body: JSON.stringify({ privyToken }), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(60_000) })
      const data = await response.json()
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${data.error?.message ?? 'Comparison failed'}`)
      setResult(JSON.stringify(data, null, 2))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Comparison failed') }
    finally { setBusy(false) }
  }
  return <section className="space-y-4 border-t border-beige-darker pt-8">
    <h2 className="font-serif text-2xl font-bold">Customer token vs Privy token</h2>
    <p className="text-sm text-ink-muted">Compare the public hook’s token with the internal token in browser storage, if available. Each is sent to the local backend for the same direct REST exchange. Only fingerprints, claim comparisons and HTTP results are shown.</p>
    <p className="text-xs text-ink-muted">Diagnostic only—not a production integration. No wallets are created, no export is performed, and any returned encrypted authorization key is discarded.</p>
    <button disabled={!authenticated || busy} onClick={compare} className="bg-black px-5 py-3 font-mono text-xs text-white disabled:opacity-40">{busy ? 'Comparing…' : 'Compare customer vs Privy token'}</button>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {result && <pre aria-live="polite" className="overflow-x-auto border border-beige-darker bg-[#faf7f1] p-4 font-mono text-xs">{result}</pre>}
  </section>
}

function QuorumWalletTest() {
  const { authenticated, user, getAccessToken } = usePrivy()
  const requestId = useRef(crypto.randomUUID())
  const [wallet, setWallet] = useState<{ owner: string; address: string; key?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [restResult, setRestResult] = useState('')
  const selected = authenticated && wallet?.owner === user?.id ? wallet : null
  async function testRest() {
    if (!authenticated || busy) return
    setBusy(true); setError(''); setRestResult('')
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Sign in first')
      const response = await fetch(`${(process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001').replace(/\/$/, '')}/v1/test/privy-jwt-rest`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000) })
      const data = await response.json()
      if (!response.ok) throw new Error(`Agentis HTTP ${response.status}: ${data.error?.message ?? 'REST test failed'}`)
      setRestResult(JSON.stringify(data, null, 2))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'REST test failed') }
    finally { setBusy(false) }
  }
  useEffect(() => {
    const hide = () => { if (document.hidden) setWallet(current => current ? { ...current, key: undefined } : null) }
    document.addEventListener('visibilitychange', hide)
    return () => document.removeEventListener('visibilitychange', hide)
  }, [])
  async function run(exporting: boolean, signer: 'user' | 'server' = 'user') {
    if (!user || !authenticated || busy || (exporting && !selected)) return
    if (exporting && !window.confirm(`Export this throwaway wallet’s private key using the ${signer} quorum member? Keep it secure and unfunded.`)) return
    const owner = user.id
    setBusy(true); setError('')
    setWallet(current => current ? { ...current, key: undefined } : null)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Sign in first')
      const response = await fetch(`${(process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001').replace(/\/$/, '')}/v1/test/quorum-wallets${exporting ? signer === 'server' ? '/export-server' : '/export' : ''}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ requestId: requestId.current, ...(exporting ? { confirm: true } : {}) }), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(60_000) })
      const data = await response.json()
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${data.error?.message ?? 'Request failed'}`)
      if (exporting) { if (!document.hidden) setWallet(current => current?.owner === owner ? { ...current, key: data.privateKey } : current) }
      else {
        if (!data.serverAuthorized) throw new Error('User + server quorum was not verified')
        setWallet({ owner, address: data.address })
      }
    } catch (cause) { setError(`${exporting ? `${signer} export` : 'Create'} failed: ${cause instanceof Error ? cause.message : 'Unknown error'}`) }
    finally { setBusy(false) }
  }
  return <section className="space-y-4 border-t border-beige-darker pt-8">
    <h2 className="font-serif text-2xl font-bold">Backend quorum wallet test</h2>
    <p className="text-sm text-ink-muted">New throwaway wallet with the same user + server 1-of-2 quorum. Stored only in Privy—not in Agentis. Test user-JWT authorization and server-member authorization separately. Neither automatically falls back to the other.</p>
    <div className="flex flex-wrap gap-3"><button disabled={!authenticated || busy || !!selected} onClick={() => run(false)} className="bg-black px-5 py-3 font-mono text-xs text-white disabled:opacity-40">1. Create quorum wallet</button><button disabled={!authenticated || busy || !selected} onClick={() => run(true)} className="bg-black px-5 py-3 font-mono text-xs text-white disabled:opacity-40">2. Export using user JWT</button><button disabled={!authenticated || busy || !selected} onClick={() => run(true, 'server')} className="bg-black px-5 py-3 font-mono text-xs text-white disabled:opacity-40">3. Export using server member</button></div>
    {busy && <p role="status" className="text-sm">Working…</p>}
    {selected && <p className="break-all border border-beige-darker bg-[#faf7f1] p-4 font-mono text-xs">{selected.address}</p>}
    {selected?.key && <div><p className="mb-2 text-xs text-red-700">Keep this key secure. Hidden when you switch tabs.</p><textarea aria-label="Throwaway quorum wallet private key" readOnly spellCheck={false} autoComplete="off" value={selected.key} className="w-full border border-beige-darker p-3 font-mono text-xs" /><button className="font-mono text-xs underline" onClick={() => setWallet(current => current ? { ...current, key: undefined } : null)}>Hide key</button></div>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="space-y-3 border-t border-beige-darker pt-5"><h3 className="font-serif text-xl font-bold">JWT exchange without the SDK</h3><p className="text-sm text-ink-muted">Backend sends your current access token directly to POST /v1/wallets/authenticate using plain fetch. No SDK exchange, new wallet, signing, or export. Any encrypted authorization key is discarded.</p><button disabled={!authenticated || busy} onClick={testRest} className="bg-black px-5 py-3 font-mono text-xs text-white disabled:opacity-40">Test JWT via direct REST</button>{restResult && <pre aria-live="polite" className="overflow-x-auto border border-beige-darker bg-[#faf7f1] p-4 font-mono text-xs">{restResult}</pre>}</div>
  </section>
}
