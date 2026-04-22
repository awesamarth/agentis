'use client'

import { usePrivy } from '@privy-io/react-auth'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

const API = process.env.NEXT_PUBLIC_BACKEND_URL

export default function CliAuth() {
  const { ready, authenticated, login, getAccessToken } = usePrivy()
  const searchParams = useSearchParams()
  const sessionId = searchParams.get('session')

  const [status, setStatus] = useState<'idle' | 'completing' | 'done' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  // Once authenticated, complete the session
  useEffect(() => {
    if (!ready || !authenticated || !sessionId || status !== 'idle') return
    completeSession()
  }, [ready, authenticated, sessionId, status])

  async function completeSession() {
    setStatus('completing')
    try {
      const token = await getAccessToken()
      const res = await fetch(`${API}/auth/session/${sessionId}/complete`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const data = await res.json()
        setErrorMsg(data.error ?? 'Something went wrong')
        setStatus('error')
        return
      }
      setStatus('done')
    } catch {
      setErrorMsg('Failed to reach backend')
      setStatus('error')
    }
  }

  if (!sessionId) {
    return (
      <main className="min-h-screen bg-beige flex items-center justify-center">
        <p className="font-mono text-sm text-ink-muted">invalid login link.</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-beige flex items-center justify-center">
      <div className="max-w-sm w-full px-8">
        <h1 className="font-serif font-black text-3xl text-black tracking-tight mb-2">agentis cli</h1>
        <p className="font-mono text-[0.65rem] text-ink-muted tracking-widest mb-10">authenticate your terminal session</p>

        {status === 'done' ? (
          <div className="bg-black p-6">
            <p className="font-mono text-sm text-beige mb-1">authenticated.</p>
            <p className="font-mono text-[0.65rem] text-beige/50 tracking-widest">you can close this tab and return to your terminal.</p>
          </div>
        ) : status === 'error' ? (
          <div className="bg-white border border-beige-darker p-6">
            <p className="font-mono text-sm text-black mb-1">error</p>
            <p className="font-mono text-[0.65rem] text-ink-muted tracking-widest">{errorMsg}</p>
          </div>
        ) : status === 'completing' ? (
          <div className="bg-white border border-beige-darker p-6">
            <p className="font-mono text-[0.65rem] text-ink-muted tracking-widest">completing authentication...</p>
          </div>
        ) : !authenticated ? (
          <div>
            <p className="font-mono text-[0.65rem] text-ink-muted tracking-widest mb-6">
              sign in to link your account to the CLI.
            </p>
            <button
              onClick={login}
              className="w-full bg-black text-beige font-mono text-xs tracking-widest py-3 hover:bg-ink transition-colors cursor-pointer"
            >
              sign in →
            </button>
          </div>
        ) : (
          <div className="bg-white border border-beige-darker p-6">
            <p className="font-mono text-[0.65rem] text-ink-muted tracking-widest">completing authentication...</p>
          </div>
        )}
      </div>
    </main>
  )
}
