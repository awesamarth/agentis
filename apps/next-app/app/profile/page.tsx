'use client'

import { usePrivy } from '@privy-io/react-auth'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AgentisClient } from '@agentis-hq/sdk'
import { Copy, Check } from 'lucide-react'
import Navbar from '@/components/Navbar'
import WalletAccess from '@/components/WalletAccess'

function money(micros: string) {
  const cents = (BigInt(micros) + 5000n) / 10000n
  return `$${(cents / 100n).toLocaleString('en-US')}.${(cents % 100n).toString().padStart(2, '0')}`
}
const colors = ['#c8a96e', '#2a2620', '#8f7a50', '#b8955a', '#6b6459', '#d6c18a', '#4a4340', '#aeb9c8']
const heading = 'mb-4 font-mono text-[0.6rem] uppercase tracking-widest text-ink-muted'

export default function ProfilePage() {
  const { ready, authenticated, user, getAccessToken } = usePrivy()
  const router = useRouter()
  const [copyStatus, setCopyStatus] = useState('')
  useEffect(() => { if (ready && !authenticated) router.replace('/dashboard') }, [ready, authenticated, router])
  const client = new AgentisClient({ baseUrl: process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001', token: async () => { const token = await getAccessToken(); if (!token) throw new Error('Sign in first'); return token } })
  const summary = useQuery({ queryKey: ['profile', user?.id], enabled: ready && authenticated, queryFn: () => client.profile.get() })
  const data = summary.data
  const identity = user?.google?.email ?? user?.github?.email ?? user?.email?.address ?? user?.wallet?.address ?? 'Your account'
  const method = user?.google ? 'google' : user?.github ? 'github' : user?.email ? 'email' : user?.wallet ? 'wallet' : 'Privy'
  const daily = data?.daily ?? []
  const max = daily.reduce((max, day) => BigInt(day.spendMicros) > max ? BigInt(day.spendMicros) : max, 1n)
  const byAgent = data?.byAgent ?? []
  const breakdown = byAgent.length > 8 ? [...byAgent.slice(0, 7), { id: 'other', name: 'Other agents', spendMicros: byAgent.slice(7).reduce((sum, a) => sum + BigInt(a.spendMicros), 0n).toString() }] : byAgent
  if (!ready || !authenticated) return <><Navbar showCrumb="profile" /><main className="mx-auto max-w-4xl px-6 py-12"><p role="status" className="text-sm text-ink-muted">Loading your profile…</p></main></>
  return <div className="min-h-screen bg-beige">
    <Navbar showCrumb="profile" />
    <main className="mx-auto max-w-4xl space-y-10 px-6 py-12 sm:px-8">
      <section><h1 className={heading}>identity</h1>
        <div className="flex items-center gap-4 border border-beige-darker bg-white p-6">
          <div aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center bg-black font-serif text-lg font-black text-beige">{identity[0].toUpperCase()}</div>
          <div className="min-w-0"><div className="flex items-center gap-2"><p className="break-all font-mono text-sm">{identity}</p><button aria-label="Copy identity" className="shrink-0 text-ink-muted hover:text-ink" onClick={async () => { try { await navigator.clipboard.writeText(identity); setCopyStatus('Copied') } catch { setCopyStatus('Could not copy. Select the text to copy manually.') } }}>{copyStatus === 'Copied' ? <Check size={12} /> : <Copy size={12} />}</button></div><p className="mt-1 font-mono text-[0.6rem] tracking-widest text-ink-muted">{method}</p><p role="status" className="text-xs text-ink-muted">{copyStatus}</p></div>
        </div>
      </section>
      <section><h2 className={heading}>overview</h2><div className="grid gap-4 sm:grid-cols-3">{[
        { label: 'total agents', value: data?.totalAgents }, { label: 'active agents', value: data?.activeAgents }, { label: 'total spend', value: data ? money(data.totalSpendMicros) : undefined },
      ].map(stat => <div key={stat.label} className="border border-beige-darker bg-white p-5"><p className={heading}>{stat.label}</p><p className="font-serif text-2xl font-bold">{stat.value ?? '—'}</p></div>)}</div>
        {summary.isPending && <p role="status" className="mt-3 text-xs text-ink-muted">Loading overview…</p>}
        {summary.error && <p role="alert" className="mt-3 text-sm text-ink-muted">{summary.error.message}</p>}
        {!!data?.unpricedPayments && <p className="mt-3 text-xs text-ink-muted">{data.unpricedPayments} older payment(s) have no USD accounting and are excluded.</p>}
      </section>
      {data && <section className="space-y-6"><h2 className={heading}>spend analytics</h2>
        <div className="border border-beige-darker bg-white p-6">
          <p className="font-mono text-xs text-ink-muted">daily spend — last 14 days</p><p className="mt-1 font-mono text-[0.6rem] uppercase tracking-widest text-ink-muted">USD settled through Agentis · fees included · UTC</p>
          {BigInt(data.totalSpendMicros) === 0n ? <p className="py-12 text-center text-sm text-ink-muted">Your spending will appear here after your first settled payment.</p> : <>
            <div className="mt-6 grid h-52 grid-cols-14 items-end gap-1 border-b border-beige-darker bg-beige/50 px-2 pt-5 sm:gap-3">{daily.map(day => <div key={day.date} className="flex h-full items-end justify-center"><div tabIndex={0} aria-label={`${day.date}: ${money(day.spendMicros)}`} title={`${day.date}: ${money(day.spendMicros)}`} className="w-full max-w-5 bg-accent focus-visible:outline-2 focus-visible:outline-ink" style={{ height: `${Number(BigInt(day.spendMicros) * 10000n / max) / 100}%`, minHeight: BigInt(day.spendMicros) > 0n ? 3 : 0 }} /></div>)}</div>
            <div className="mt-3 flex justify-between font-mono text-[0.6rem] text-ink-muted"><span>{daily[0]?.date.slice(5)}</span><span>{daily.at(-1)?.date.slice(5)}</span></div>
            <details className="mt-4 text-xs text-ink-muted"><summary className="cursor-pointer font-mono">daily amounts</summary><dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2">{daily.map(day => <div key={day.date} className="flex flex-wrap justify-between gap-2"><dt>{day.date}</dt><dd>{money(day.spendMicros)}</dd></div>)}</dl></details>
          </>}
        </div>
        {breakdown.length > 1 && <div className="border border-beige-darker bg-white p-6"><p className="mb-6 font-mono text-xs text-ink-muted">spend by agent</p><div className="grid items-center gap-6 sm:grid-cols-2">
          <svg viewBox="0 0 120 120" role="img" aria-label="Spend by agent; amounts listed alongside" className="mx-auto w-full max-w-60 -rotate-90">{breakdown.map((a, i) => { const percent = Number(BigInt(a.spendMicros) * 1000000n / BigInt(data.totalSpendMicros)) / 10000; const start = Number(breakdown.slice(0, i).reduce((sum, item) => sum + BigInt(item.spendMicros), 0n) * 1000000n / BigInt(data.totalSpendMicros)) / 10000; return <circle key={a.id ?? 'unassigned'} cx="60" cy="60" r="45" pathLength="100" fill="none" stroke={colors[i % colors.length]} strokeWidth="16" strokeDasharray={`${percent} ${100 - percent}`} strokeDashoffset={-start}><title>{a.name}: {money(a.spendMicros)}</title></circle> })}</svg>
          <ul className="space-y-2">{breakdown.map((a, i) => <li key={a.id ?? 'unassigned'} className="flex items-center gap-3 border border-beige-darker/70 bg-beige/40 px-3 py-2"><span className="h-3 w-3 shrink-0" style={{ backgroundColor: colors[i % colors.length] }} /><div className="min-w-0 font-mono text-xs"><p className="break-words">{a.name}</p><p className="mt-1 text-ink-muted">{money(a.spendMicros)}</p></div></li>)}</ul>
        </div></div>}
      </section>}
      <WalletAccess />
    </main>
  </div>
}
