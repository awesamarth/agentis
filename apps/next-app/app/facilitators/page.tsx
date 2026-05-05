'use client'

import { useEffect, useMemo, useState } from 'react'
import Navbar from '@/components/Navbar'

const API = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'https://api.agentis.systems'

type Facilitator = {
  id: string
  name: string
  status: 'scaffolded' | 'live' | 'offline'
  network: string
  acceptedMint: string
  feeBps: number
  publicUrl: string | null
  listed: boolean
  createdAt: string
  updatedAt: string
  lastHeartbeatAt?: string
  metrics?: {
    version?: string
    supported?: string[]
    settledCount?: number
    settledVolumeUsd?: number
    sellerCount?: number
    feeBps?: number
  }
}

function shortMint(mint: string) {
  if (!mint) return 'unknown'
  if (mint.length <= 16) return mint
  return `${mint.slice(0, 6)}...${mint.slice(-4)}`
}

function formatNetwork(network: string) {
  if (!network) return 'unknown'
  if (network === 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1') return 'solana devnet'
  return network.replaceAll('-', ' ').replace('solana:', 'solana ')
}

function formatSeen(value?: string) {
  if (!value) return 'no heartbeat'
  const diffMs = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(diffMs) || diffMs < 0) return 'just now'
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function statusClasses(status: Facilitator['status']) {
  if (status === 'live') return 'border-ink bg-black text-beige'
  if (status === 'offline') return 'border-beige-darker bg-beige-dark text-ink-muted'
  return 'border-beige-darker bg-white text-ink-muted'
}

export default function FacilitatorsPage() {
  const [facilitators, setFacilitators] = useState<Facilitator[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadFacilitators() {
      if (!API) {
        setError('Backend URL is not configured.')
        setLoading(false)
        return
      }

      try {
        const res = await fetch(`${API}/facilitators/explore`, { cache: 'no-store' })
        const data = await res.json().catch(() => [])
        if (!res.ok) throw new Error(data?.error ?? 'Failed to load facilitators')
        if (!cancelled) setFacilitators(Array.isArray(data) ? data : [])
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load facilitators')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadFacilitators()
    return () => {
      cancelled = true
    }
  }, [])

  const liveCount = useMemo(
    () => facilitators.filter(facilitator => facilitator.status === 'live').length,
    [facilitators],
  )

  return (
    <main className="min-h-screen bg-beige text-ink">
      <Navbar showCrumb="facilitators" />

      <section className="px-6 py-12 sm:px-10 lg:px-16">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-10 border-b border-beige-darker pb-12 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <p className="mb-5 font-mono text-[0.68rem] uppercase tracking-[0.2em] text-ink-muted">
                x402 facilitator network
              </p>
              <h1
                className="max-w-4xl font-serif font-black leading-[0.9] tracking-[-0.03em] text-black"
                style={{ fontSize: 'clamp(3.75rem, 8vw, 7.5rem)' }}
              >
                Discover payment facilitators.
              </h1>
              <p className="mt-7 max-w-2xl font-sans text-lg font-light leading-relaxed text-ink-muted sm:text-xl">
                Agentis-created facilitators can publish their public URL, network, fees, and heartbeat status here.
              </p>
            </div>

            <div className="grid grid-cols-2 border border-beige-darker bg-[#f8f4ed]/70 text-center shadow-[10px_10px_0_rgba(42,38,32,0.06)]">
              <div className="border-r border-beige-darker px-8 py-6">
                <div className="font-mono text-4xl text-black">{facilitators.length}</div>
                <div className="mt-2 font-mono text-[0.65rem] uppercase tracking-[0.18em] text-ink-muted">listed</div>
              </div>
              <div className="px-8 py-6">
                <div className="font-mono text-4xl text-black">{liveCount}</div>
                <div className="mt-2 font-mono text-[0.65rem] uppercase tracking-[0.18em] text-ink-muted">live</div>
              </div>
            </div>
          </div>

          {loading && (
            <div className="grid gap-4 py-12">
              {[0, 1, 2].map(i => (
                <div key={i} className="h-28 animate-pulse border border-beige-darker bg-[#f8f4ed]/70" />
              ))}
            </div>
          )}

          {!loading && error && (
            <div className="mt-12 border border-beige-darker bg-[#f8f4ed]/70 p-8">
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-ink-muted">network unavailable</p>
              <p className="mt-3 font-sans text-lg text-black">{error}</p>
            </div>
          )}

          {!loading && !error && facilitators.length === 0 && (
            <div className="mt-12 border border-beige-darker bg-[#f8f4ed]/70 p-8">
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-ink-muted">no listed facilitators yet</p>
              <p className="mt-3 max-w-2xl font-sans text-lg font-light leading-relaxed text-ink-muted">
                Create one with the Agentis CLI, deploy it, then publish it with a public URL and listing enabled.
              </p>
              <code className="mt-6 block w-fit border border-beige-darker bg-beige px-4 py-3 font-mono text-sm text-black">
                agentis facilitator publish &lt;name&gt; --url &lt;public-url&gt; --listed
              </code>
            </div>
          )}

          {!loading && !error && facilitators.length > 0 && (
            <div className="grid gap-4 py-12">
              {facilitators.map(facilitator => (
                <article
                  key={facilitator.id}
                  className="grid gap-6 border border-beige-darker bg-[#f8f4ed]/70 p-6 shadow-[8px_8px_0_rgba(42,38,32,0.05)] lg:grid-cols-[1.2fr_1fr_auto] lg:items-center"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="font-serif text-3xl font-black text-black">{facilitator.name}</h2>
                      <span className={`border px-3 py-1 font-mono text-[0.65rem] uppercase tracking-[0.16em] ${statusClasses(facilitator.status)}`}>
                        {facilitator.status}
                      </span>
                    </div>
                    <p className="mt-3 font-mono text-xs text-ink-muted">{facilitator.id}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-x-6 gap-y-4 font-mono text-xs">
                    <div>
                      <div className="uppercase tracking-[0.16em] text-ink-muted">network</div>
                      <div className="mt-1 text-black">{formatNetwork(facilitator.network)}</div>
                    </div>
                    <div>
                      <div className="uppercase tracking-[0.16em] text-ink-muted">fee</div>
                      <div className="mt-1 text-black">{facilitator.metrics?.feeBps ?? facilitator.feeBps} bps</div>
                    </div>
                    <div>
                      <div className="uppercase tracking-[0.16em] text-ink-muted">mint</div>
                      <div className="mt-1 text-black">{shortMint(facilitator.acceptedMint)}</div>
                    </div>
                    <div>
                      <div className="uppercase tracking-[0.16em] text-ink-muted">heartbeat</div>
                      <div className="mt-1 text-black">{formatSeen(facilitator.lastHeartbeatAt)}</div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 lg:items-end">
                    {facilitator.publicUrl ? (
                      <a
                        href={facilitator.publicUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="bg-black px-5 py-3 text-center font-mono text-xs tracking-widest text-beige transition-colors hover:bg-ink"
                      >
                        open endpoint →
                      </a>
                    ) : (
                      <span className="border border-beige-darker px-5 py-3 text-center font-mono text-xs tracking-widest text-ink-muted">
                        no public url
                      </span>
                    )}
                    <div className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-ink-muted">
                      {facilitator.metrics?.sellerCount ?? 0} sellers · {facilitator.metrics?.settledCount ?? 0} settled
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  )
}
