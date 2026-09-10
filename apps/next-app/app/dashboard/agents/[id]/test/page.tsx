'use client'

import { useEffect, useRef, useState } from 'react'
import { AgentisClient, type AgentisWallet } from '@agentis-hq/sdk'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { usePrivy } from '@privy-io/react-auth'
import Navbar from '@/components/Navbar'

type Report = { token: Record<string, boolean | number>; exchange: { ok: boolean; status: number | null; requestId: string | null; error: string | null } }

export default function AuthorizationTestPage() {
  const { id } = useParams<{ id: string }>()
  const { ready, authenticated, getAccessToken, login } = usePrivy()
  const [busy, setBusy] = useState(false)
  const testId = useRef<string | null>(null)
  const [wallet, setWallet] = useState<AgentisWallet | null>(null)
  const [privateKey, setPrivateKey] = useState('')
  useEffect(() => {
    const hide = () => { if (document.hidden) setPrivateKey('') }
    document.addEventListener('visibilitychange', hide)
    return () => { document.removeEventListener('visibilitychange', hide); setPrivateKey('') }
  }, [authenticated])
  const client = new AgentisClient({ baseUrl: process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001', token: async () => { const token = await getAccessToken(); if (!token) throw new Error('Sign in first'); return token } })
  async function createWallet() {
    setBusy(true); setError(''); setPrivateKey('')
    try {
      testId.current ??= crypto.randomUUID()
      await client.agents.create({ id: testId.current, name: 'Export test', mode: 'paused', allowedRecipients: [], limits: { perTransaction: null, hourly: null, daily: null, total: null }, selection: { networks: ['base'], defaultNetwork: 'base' } })
      const created = (await client.wallets.list()).find(item => item.agentId === testId.current)
      if (!created) throw new Error('Wallet created but not returned by wallet listing. Retry to load it.')
      setWallet(created)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Wallet creation failed') }
    finally { setBusy(false) }
  }
  async function exportKey() {
    if (!wallet || !window.confirm('Reveal this test wallet’s private key? Anyone with it can control the wallet. Keep it secure.')) return
    setBusy(true); setError(''); setPrivateKey('')
    try { const result = await client.wallets.exportKey(wallet.id, { confirm: true }); if (!document.hidden) setPrivateKey(result.privateKey) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Export failed') }
    finally { setBusy(false) }
  }
  const [tokenRead, setTokenRead] = useState(false)
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState('')
  async function run() {
    setBusy(true); setReport(null); setError(''); setTokenRead(false)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Sign in first; no owner access token is available.')
      setTokenRead(true)
      const response = await fetch(`${(process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001').replace(/\/$/, '')}/v1/diagnostics/privy-authorization`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000) })
      const body = await response.json()
      if (!response.ok) throw new Error(`Agentis HTTP ${response.status}: ${body.error?.message ?? 'Diagnostic request failed'}`)
      setReport(body as Report)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Diagnostic request failed') }
    finally { setBusy(false) }
  }
  return <><Navbar showCrumb="authorization test" /><main className="mx-auto max-w-3xl space-y-7 px-6 py-12 sm:px-8">
    <Link href={`/dashboard/agents/${id}`} className="font-mono text-xs text-ink-muted hover:text-ink">← agent</Link>
    <header><h1 className="font-serif text-3xl font-bold">Wallet export test</h1><p className="mt-3 text-sm text-ink-muted">Create a new, unfunded Base test wallet with the same user + server quorum, then try exporting its key. No payments. Existing wallets are untouched.</p></header>
    <section className="space-y-4 border border-beige-darker bg-white p-5">
      {!authenticated && ready && <button onClick={() => login()} className="font-mono text-xs underline">Sign in first</button>}
      <div className="flex flex-wrap gap-3"><button disabled={!authenticated || busy || !!wallet} onClick={createWallet} className="bg-black px-5 py-2.5 font-mono text-xs text-white disabled:opacity-40">1. Create test wallet</button><button disabled={!authenticated || busy || !wallet} onClick={exportKey} className="bg-black px-5 py-2.5 font-mono text-xs text-white disabled:opacity-40">2. Export key</button></div>
      {busy && <p role="status" className="text-sm">Working…</p>}
      {wallet && <div className="text-sm"><p className="break-all font-mono text-xs">{wallet.address}</p><Link href={`/dashboard/agents/${wallet.agentId}`} className="mt-2 inline-block text-xs underline">Open created test agent</Link></div>}
      {privateKey && authenticated && <div><p className="mb-2 text-sm text-red-700">Keep this private key secure. Never share it.</p><textarea aria-label="Test wallet private key" readOnly spellCheck={false} autoComplete="off" value={privateKey} className="w-full border border-beige-darker bg-[#faf7f1] p-3 font-mono text-xs" /><button onClick={() => setPrivateKey('')} className="mt-2 font-mono text-xs underline">Hide key</button></div>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </section>
    <h2 className="font-serif text-xl font-bold">Optional: isolate the JWT failure</h2>
    <p className="text-sm text-ink-muted">The diagnostic below only exchanges the login JWT. It does not export or sign anything.</p>
    <section className="border border-beige-darker bg-[#faf7f1] p-5 text-sm">
      <p>The failing request does <strong>not</strong> contain a wallet address or wallet ID. It asks Privy to exchange your signed-in user’s access token for an encrypted, temporary authorization key.</p>
      <pre className="mt-4 overflow-x-auto font-mono text-xs leading-relaxed">{'POST https://api.privy.io/v1/wallets/authenticate\nAuthorization: Basic [app credentials — server only]\nprivy-app-id: [configured app]\n\n{\n  "user_jwt": "[your access token — never displayed]",\n  "encryption_type": "HPKE",\n  "recipient_public_key": "[ephemeral P-256 public key]"\n}'}</pre>
      <p className="mt-4 text-xs text-ink-muted">On success, the encrypted authorization key is discarded without decrypting it.</p>
    </section>
    <div className="flex flex-wrap gap-3">{ready && !authenticated && <button onClick={() => login()} className="border border-beige-darker px-5 py-2.5 font-mono text-xs">Sign in</button>}<button disabled={!ready || !authenticated || busy} onClick={run} className="bg-black px-5 py-2.5 font-mono text-xs tracking-widest text-white disabled:opacity-40">{busy ? 'Testing…' : 'Test owner JWT'}</button></div>
    <ol className="divide-y divide-beige-darker border border-beige-darker bg-white px-5" aria-live="polite">
      <li className="py-4"><p className="font-mono text-xs">01 · Browser access token — {tokenRead ? 'obtained' : 'not tested'}</p></li>
      <li className="py-4"><p className="font-mono text-xs">02 · Agentis JWT verification — {report ? 'passed' : 'not confirmed'}</p>{report && <dl className="mt-3 space-y-1 text-xs text-ink-muted">{Object.entries(report.token).map(([key, value]) => <div key={key} className="flex justify-between gap-4"><dt>{key}</dt><dd className="font-mono">{String(value)}</dd></div>)}</dl>}</li>
      <li className="py-4"><p className={`font-mono text-xs ${report && !report.exchange.ok ? 'text-red-700' : ''}`}>03 · Privy JWT exchange — {report ? `${report.exchange.ok ? 'passed' : 'failed'}${report.exchange.status !== null ? ` · HTTP ${report.exchange.status}` : ''}` : 'not tested'}</p>{report?.exchange.error && <p className="mt-2 text-sm text-red-700">{report.exchange.error}</p>}{report?.exchange.requestId && <p className="mt-2 break-all font-mono text-xs text-ink-muted">Provider request ID: {report.exchange.requestId}</p>}</li>
      <li className="py-4"><p className="font-mono text-xs">04 · Sign export request — intentionally not run</p></li>
      <li className="py-4"><p className="font-mono text-xs">05 · Export wallet key — intentionally not run</p></li>
    </ol>
    <section className="space-y-3 text-sm text-ink-muted"><h2 className="font-serif text-xl font-bold text-ink">Which signature?</h2><p>The JWT already has Privy’s signature, which proves who issued the login token. Agentis verifies that signature in step 2.</p><p>A successful exchange would provide a temporary <strong>user authorization key</strong>. The SDK would use it to sign the exact export request for Privy’s <span className="font-mono text-xs">privy-authorization-signature</span> header. That signature satisfies the user side of the 1-of-2 owner quorum—not a wallet transaction signature.</p><p>If step 3 fails, that export authorization signature is never generated. This test never uses the server quorum key.</p></section>
  </main></>
}
