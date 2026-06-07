'use client'

import { usePrivy } from '@privy-io/react-auth'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'

const API = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'https://api.agentis.systems'

type AuthorizationRequest = {
  id: string
  clientName: string
  scope: string[]
  resource?: string
}

const SCOPE_LABELS: Record<string, string> = {
  'wallets:read': 'View agent wallets and balances',
  'wallets:write': 'Create and manage agent wallets',
  'payments:execute': 'Execute transfers and paid API requests',
  'policy:read': 'View spending policies',
  'policy:write': 'Update spending policies',
  'privacy:read': 'View Umbra privacy state',
  'privacy:write': 'Execute Umbra privacy actions',
  'earn:read': 'View Jupiter Earn positions',
  'earn:write': 'Manage Jupiter Earn positions',
}

function OAuthAuthorizeContent() {
  const { ready, authenticated, login, getAccessToken } = usePrivy()
  const requestId = useSearchParams().get('request')
  const [request, setRequest] = useState<AuthorizationRequest | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'submitting' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!requestId) {
      setError('Invalid authorization request.')
      setStatus('error')
      return
    }

    fetch(`${API}/oauth/request/${encodeURIComponent(requestId)}`)
      .then(async response => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error ?? 'Authorization request failed')
        setRequest(body)
        setStatus('ready')
      })
      .catch(cause => {
        setError(cause instanceof Error ? cause.message : 'Authorization request failed')
        setStatus('error')
      })
  }, [requestId])

  async function complete(approved: boolean) {
    if (!requestId) return
    setStatus('submitting')
    try {
      const token = await getAccessToken()
      const response = await fetch(`${API}/oauth/request/${encodeURIComponent(requestId)}/complete`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ approved }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Authorization failed')
      window.location.assign(body.redirectUrl)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Authorization failed')
      setStatus('error')
    }
  }

  return (
    <main className="min-h-screen bg-beige flex items-center justify-center px-6 py-12">
      <section className="w-full max-w-lg">
        <div className="mb-10">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink-muted mb-3">Agentis authorization</p>
          <h1 className="font-serif font-black text-4xl text-black tracking-tight">
            {request?.clientName ?? 'Connect an application'}
          </h1>
          <p className="font-mono text-xs text-ink-muted mt-3">
            wants permission to operate your Agentis account.
          </p>
        </div>

        {status === 'error' ? (
          <div className="border border-beige-darker bg-white p-6 font-mono text-sm text-black">{error}</div>
        ) : status === 'loading' ? (
          <div className="border border-beige-darker bg-white p-6 font-mono text-xs text-ink-muted">
            loading authorization request...
          </div>
        ) : !authenticated ? (
          <button
            type="button"
            onClick={login}
            disabled={!ready}
            className="w-full bg-black text-beige font-mono text-xs uppercase tracking-[0.16em] py-4 cursor-pointer disabled:opacity-50"
          >
            Sign in to continue
          </button>
        ) : (
          <>
            <div className="border border-beige-darker bg-white">
              {request?.scope.map(scope => (
                <div
                  key={scope}
                  className="flex items-start gap-3 px-5 py-4 border-b border-beige-darker last:border-b-0"
                >
                  <span className="font-mono text-xs text-green-700 mt-0.5">✓</span>
                  <span className="font-mono text-xs text-black">
                    {SCOPE_LABELS[scope] ?? scope}
                  </span>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3 mt-5">
              <button
                type="button"
                onClick={() => complete(false)}
                disabled={status === 'submitting'}
                className="border border-black bg-transparent text-black font-mono text-xs uppercase tracking-[0.16em] py-4 cursor-pointer disabled:opacity-50"
              >
                Deny
              </button>
              <button
                type="button"
                onClick={() => complete(true)}
                disabled={status === 'submitting'}
                className="bg-black text-beige font-mono text-xs uppercase tracking-[0.16em] py-4 cursor-pointer disabled:opacity-50"
              >
                {status === 'submitting' ? 'Authorizing...' : 'Authorize'}
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  )
}

export default function OAuthAuthorizePage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen bg-beige flex items-center justify-center">
        <p className="font-mono text-sm text-ink-muted">loading...</p>
      </main>
    }>
      <OAuthAuthorizeContent />
    </Suspense>
  )
}
