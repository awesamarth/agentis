'use client'

import { usePrivy } from '@privy-io/react-auth'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AgentisClient } from '@agentis-hq/sdk'
import { Copy, Check } from 'lucide-react'
import Navbar from '@/components/Navbar'
import ProfileAnalytics, { profileMoney } from '@/components/ProfileAnalytics'
const heading = 'mb-4 font-mono text-[0.6rem] uppercase tracking-widest text-ink-muted'

export default function ProfilePage() {
  const { ready, authenticated, user, getAccessToken } = usePrivy()
  const router = useRouter()
  const [copyStatus, setCopyStatus] = useState('')
  useEffect(() => { if (ready && !authenticated) router.replace('/dashboard') }, [ready, authenticated, router])
  const client = new AgentisClient({ baseUrl: process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001', token: async () => { const token = await getAccessToken(); if (!token) throw new Error('Sign in first'); return token } })
  const summary = useQuery({ queryKey: ['profile', user?.id], enabled: ready && authenticated, queryFn: () => client.profile.get(), refetchInterval: 60_000 })
  const data = summary.data
  const identity = user?.google?.email ?? user?.github?.email ?? user?.email?.address ?? user?.wallet?.address ?? 'Your account'
  const method = user?.google ? 'google' : user?.github ? 'github' : user?.email ? 'email' : user?.wallet ? 'wallet' : 'Privy'
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
        { label: 'total agents', value: data?.totalAgents }, { label: 'active agents', value: data?.activeAgents }, { label: 'total spend', value: data ? profileMoney(data.totalSpendMicros) : undefined },
      ].map(stat => <div key={stat.label} className="border border-beige-darker bg-white p-5"><p className={heading}>{stat.label}</p><p className="font-serif text-2xl font-bold">{stat.value ?? '—'}</p></div>)}</div>
        {summary.isPending && <p role="status" className="mt-3 text-xs text-ink-muted">Loading overview…</p>}
        {summary.error && <p role="alert" className="mt-3 text-sm text-ink-muted">{summary.error.message}</p>}
        {!!data?.unpricedPayments && <p className="mt-3 text-xs text-ink-muted">{data.unpricedPayments} older payment(s) have no USD accounting and are excluded.</p>}
      </section>
      {data && <ProfileAnalytics data={data} />}
    </main>
  </div>
}
