'use client'

import { usePrivy } from '@privy-io/react-auth'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navbar from '@/components/Navbar'

type Agent = {
  id: string
  name: string
  walletAddress: string
  apiKey: string
  createdAt: string
}

const API = process.env.NEXT_PUBLIC_BACKEND_URL

export default function Dashboard() {
  const { ready, authenticated, getAccessToken } = usePrivy()
  const router = useRouter()
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [agentName, setAgentName] = useState('')
  const [creating, setCreating] = useState(false)
  const [revealedKey, setRevealedKey] = useState<string | null>(null)

  async function fetchAgents() {
    if (!authenticated) return
    setLoading(true)
    try {
      const token = await getAccessToken()
      const res = await fetch(`${API}/agents`, {
        headers: { authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      setAgents(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (ready && authenticated) fetchAgents()
  }, [ready, authenticated])

  async function handleCreate() {
    if (!agentName.trim()) return
    setCreating(true)
    try {
      const token = await getAccessToken()
      const res = await fetch(`${API}/agents`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name: agentName }),
      })
      const agent = await res.json()
      setAgents(prev => [agent, ...prev])
      setRevealedKey(agent.apiKey)
      setAgentName('')
      setShowModal(false)
    } finally {
      setCreating(false)
    }
  }

  return (
    <main className="min-h-screen bg-beige">
      <Navbar showCrumb="dashboard" />

      <div className="max-w-5xl mx-auto px-12 py-16">
        <div className="flex items-end justify-between mb-12">
          <div>
            <h1 className="font-serif font-black text-4xl text-black tracking-tight mb-1">Your Agents</h1>
            <p className="font-mono text-xs text-ink-muted tracking-widest">manage wallets, policies, and spending</p>
          </div>
          {ready && authenticated && (
            <button
              onClick={() => setShowModal(true)}
              className="bg-black text-beige font-mono text-xs tracking-widest px-6 py-3 hover:bg-ink transition-colors cursor-pointer"
            >
              + create agent
            </button>
          )}
        </div>

        {/* Revealed API key banner */}
        {revealedKey && (
          <div className="border border-beige-darker bg-white p-5 mb-8 flex items-center justify-between gap-4">
            <div>
              <p className="font-mono text-[0.65rem] text-ink-muted tracking-widest mb-1 uppercase">API Key — save this, it won't be shown again</p>
              <p className="font-mono text-sm text-black">{revealedKey}</p>
            </div>
            <button
              onClick={() => { navigator.clipboard.writeText(revealedKey); setRevealedKey(null) }}
              className="font-mono text-xs tracking-widest text-ink-muted border border-beige-darker px-4 py-2 hover:border-ink-muted transition-colors cursor-pointer shrink-0"
            >
              copy & dismiss
            </button>
          </div>
        )}

        {/* Agent list */}
        {!ready || loading ? (
          <p className="font-mono text-xs text-ink-muted tracking-widest">loading...</p>
        ) : !authenticated ? (
          <div className="border border-dashed border-beige-darker py-24 flex flex-col items-center gap-4">
            <p className="font-mono text-xs text-ink-muted tracking-widest">sign in to manage your agents</p>
          </div>
        ) : agents.length === 0 ? (
          <div className="border border-dashed border-beige-darker py-24 flex flex-col items-center gap-6">
            <p className="font-mono text-xs text-ink-muted tracking-widest">no agents yet</p>
            <button
              onClick={() => setShowModal(true)}
              className="bg-black text-beige font-mono text-xs tracking-widest px-6 py-3 hover:bg-ink transition-colors cursor-pointer"
            >
              + create agent
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {agents.map(agent => (
              <div
                key={agent.id}
                onClick={() => router.push(`/dashboard/agents/${agent.id}`)}
                className="border border-beige-darker bg-white p-6 flex items-center justify-between cursor-pointer hover:border-ink-muted hover:shadow-sm transition-all group"
              >
                <div>
                  <p className="font-serif font-bold text-lg text-black mb-1 group-hover:text-ink transition-colors">{agent.name}</p>
                  <p className="font-mono text-[0.65rem] text-ink-muted tracking-wide">{agent.walletAddress}</p>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <p className="font-mono text-[0.65rem] text-ink-muted tracking-widest uppercase mb-1">created</p>
                    <p className="font-mono text-xs text-ink-muted">{new Date(agent.createdAt).toLocaleDateString()}</p>
                  </div>
                  <span className="font-mono text-ink-muted text-lg group-hover:translate-x-1 transition-transform">→</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create agent modal */}
      {showModal && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          onClick={() => setShowModal(false)}
        >
          <div
            className="bg-beige border border-beige-darker p-8 w-full max-w-md"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="font-serif font-black text-2xl text-black mb-1">Create Agent</h2>
            <p className="font-mono text-[0.65rem] text-ink-muted tracking-widest mb-6">a Solana wallet will be created automatically</p>

            <label className="font-mono text-[0.65rem] text-ink-muted tracking-widest uppercase block mb-2">Agent Name</label>
            <input
              type="text"
              value={agentName}
              onChange={e => setAgentName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder="e.g. trading-agent-01"
              className="w-full bg-white border border-beige-darker px-4 py-3 font-mono text-sm text-black placeholder:text-ink-muted/50 outline-none focus:border-ink-muted transition-colors mb-6"
            />

            <div className="flex gap-3">
              <button
                onClick={handleCreate}
                disabled={creating || !agentName.trim()}
                className="flex-1 bg-black text-beige font-mono text-xs tracking-widest py-3 hover:bg-ink transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {creating ? 'creating...' : 'create agent'}
              </button>
              <button
                onClick={() => setShowModal(false)}
                className="font-mono text-xs tracking-widest text-ink-muted border border-beige-darker px-6 py-3 hover:border-ink-muted transition-colors cursor-pointer"
              >
                cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
