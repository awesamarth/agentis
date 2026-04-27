'use client'

import { Copy, Check, Lock, Unlock } from 'lucide-react'
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
  privacyEnabled?: boolean
  umbraStatus?: 'disabled' | 'pending' | 'registered' | 'failed'
  umbraError?: string
  policyMode?: 'backend' | 'onchain'
  onchainPolicy?: { initialized: boolean }
  _guest?: boolean
  _secretKeyBytes?: string  // JSON array of key bytes, only for guest agents
}

const API = process.env.NEXT_PUBLIC_BACKEND_URL
const GUEST_STORAGE_KEY = 'agentis_guest_agents'

function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false)
  function copy(e: React.MouseEvent) {
    e.stopPropagation()
    navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      onClick={copy}
      className="font-mono text-[0.65rem] text-ink-muted/50 hover:text-ink-muted transition-colors cursor-pointer ml-2 shrink-0 leading-none"
      title="copy address"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  )
}

function loadGuestAgents(): Agent[] {
  try {
    const raw = localStorage.getItem(GUEST_STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveGuestAgents(agents: Agent[]) {
  localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(agents))
}

export default function Dashboard() {
  const { ready, authenticated, getAccessToken, login } = usePrivy()
  const router = useRouter()
  const [agents, setAgents] = useState<Agent[]>([])
  const [balances, setBalances] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [agentName, setAgentName] = useState('')
  const [privacyEnabled, setPrivacyEnabled] = useState(false)
  const [policyMode, setPolicyMode] = useState<'backend' | 'onchain'>('backend')
  const [creating, setCreating] = useState(false)
  const [revealedKey, setRevealedKey] = useState<string | null>(null)

  useEffect(() => {
    if (!ready) return
    if (authenticated) {
      fetchAgents()
    } else {
      const guests = loadGuestAgents()
      setAgents(guests)
      fetchAllBalances(guests.map(a => a.walletAddress))
    }
  }, [ready, authenticated])

  async function fetchAgents() {
    setLoading(true)
    try {
      const token = await getAccessToken()
      const res = await fetch(`${API}/agents`, {
        headers: { authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      setAgents(data)
      fetchAllBalances(data.map((a: Agent) => a.walletAddress))
    } finally {
      setLoading(false)
    }
  }

  async function fetchAllBalances(addresses: string[]) {
    const results = await Promise.all(
      addresses.map(async (address) => {
        try {
          const res = await fetch('https://api.devnet.solana.com', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address, { commitment: 'confirmed' }] }),
          })
          const data = await res.json()
          return [address, data.result.value / 1e9] as [string, number]
        } catch {
          return [address, null] as [string, null]
        }
      })
    )
    const map: Record<string, number> = {}
    for (const [addr, bal] of results) {
      if (bal !== null) map[addr] = bal
    }
    setBalances(map)
  }

  async function handleCreate() {
    if (!agentName.trim()) return
    setCreating(true)
    try {
      if (authenticated) {
        const token = await getAccessToken()
        const res = await fetch(`${API}/agents`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ name: agentName, privacyEnabled, policyMode }),
        })
        const agent = await res.json()
        setAgents(prev => [agent, ...prev])
        setRevealedKey(agent.apiKey)
      } else {
        // Guest mode — generate extractable wallet with gill, store keypair locally
        const { generateExtractableKeyPairSigner, extractBytesFromKeyPairSigner } = await import('gill')
        const signer = await generateExtractableKeyPairSigner()
        const keyBytes = await extractBytesFromKeyPairSigner(signer)
        // store as JSON array — reconstructed via createKeyPairSignerFromBytes
        const secretKeyBase64 = JSON.stringify(Array.from(keyBytes))
        const guestAgent: Agent = {
          id: crypto.randomUUID(),
          name: agentName.trim(),
          walletAddress: signer.address,
          apiKey: 'agt_guest_' + Math.random().toString(36).slice(2),
          createdAt: new Date().toISOString(),
          _guest: true,
          _secretKeyBytes: secretKeyBase64,
        }
        const updated = [guestAgent, ...loadGuestAgents()]
        saveGuestAgents(updated)
        setAgents(updated)
      }
      setAgentName('')
      setPrivacyEnabled(false)
      setPolicyMode('backend')
      setShowModal(false)
    } finally {
      setCreating(false)
    }
  }

  return (
    <main className="min-h-screen bg-beige">
      <Navbar showCrumb="dashboard" />

      <div className="max-w-5xl mx-auto px-12 py-16">

        {/* Guest banner */}
        {ready && !authenticated && (
          <div className="border border-beige-darker bg-white p-4 mb-8 flex items-center justify-between gap-4">
            <p className="font-mono text-[0.65rem] text-ink-muted tracking-widest">
              you're in guest mode — agents are saved locally and won't persist across devices
            </p>
            <button
              onClick={login}
              className="font-mono text-[0.65rem] tracking-widest text-black border border-ink px-4 py-2 hover:bg-black hover:text-beige transition-colors cursor-pointer shrink-0"
            >
              sign in to save →
            </button>
          </div>
        )}

        <div className="flex items-end justify-between mb-12">
          <div>
            <h1 className="font-serif font-black text-4xl text-black tracking-tight mb-1">Your Agents</h1>
            <p className="font-mono text-xs text-ink-muted tracking-widest">manage wallets, policies, and spending</p>
          </div>
          {ready && (
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
                className={`border p-6 flex items-center justify-between cursor-pointer hover:border-ink-muted hover:shadow-sm transition-all group ${
                  agent.privacyEnabled && agent.umbraStatus === 'registered'
                    ? 'border-[#b7cce5] bg-[linear-gradient(115deg,#ffffff_0%,#ffffff_62%,#eef6ff_100%)]'
                    : 'border-beige-darker bg-white'
                }`}
              >
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-serif font-bold text-lg text-black group-hover:text-ink transition-colors">{agent.name}</p>
                    {agent._guest && (
                      <span className="font-mono text-[0.55rem] text-ink-muted border border-beige-darker px-1.5 py-0.5 tracking-widest">guest</span>
                    )}
                    {agent.policyMode === 'onchain' && (
                      <span className={`font-mono text-[0.55rem] border px-1.5 py-0.5 tracking-widest ${
                        agent.onchainPolicy?.initialized
                          ? 'text-[#6d4aff] border-[#c8b6ff] bg-[#f6f1ff]'
                          : 'text-ink-muted border-beige-darker'
                      }`}>
                        on-chain policy{agent.onchainPolicy?.initialized ? '' : ' pending'}
                      </span>
                    )}
                    {agent.privacyEnabled && agent.umbraStatus === 'registered' && (
                      <span
                        title="private agent"
                        className="text-ink-muted inline-flex h-5 w-5 items-center justify-center -translate-y-px"
                      >
                        <Lock size={12} strokeWidth={2} />
                      </span>
                    )}
                    {agent.privacyEnabled && agent.umbraStatus !== 'registered' && (
                      <span className={`font-mono text-[0.55rem] border px-1.5 py-0.5 tracking-widest inline-flex items-center gap-1.5 ${
                        agent.umbraStatus === 'failed'
                          ? 'text-red-700 border-red-200 bg-red-50'
                          : 'text-ink-muted border-beige-darker'
                      }`}>
                        <Unlock size={10} strokeWidth={2.2} />
                        registration needed
                      </span>
                    )}
                  </div>
                  <div className="flex items-center">
                    <p className="font-mono text-[0.65rem] text-ink-muted tracking-wide">{agent.walletAddress}</p>
                    <CopyAddress address={agent.walletAddress} />
                  </div>
                </div>
                <div className="flex items-center gap-8">
                  {balances[agent.walletAddress] !== undefined && (
                    <div className="text-right">
                      <p className="font-mono text-[0.65rem] text-ink-muted tracking-widest uppercase mb-1">balance</p>
                      <p className="font-mono text-sm text-black">{balances[agent.walletAddress]!.toFixed(4)} <span className="text-ink-muted text-xs">SOL</span></p>
                    </div>
                  )}
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
            <p className="font-mono text-[0.65rem] text-ink-muted tracking-widest mb-6">
              {authenticated ? 'a Solana wallet will be created automatically' : 'a local devnet wallet will be generated in your browser'}
            </p>

            <label className="font-mono text-[0.65rem] text-ink-muted tracking-widest uppercase block mb-2">Agent Name</label>
            <input
              type="text"
              value={agentName}
              onChange={e => setAgentName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder="e.g. trading-agent-01"
              className="w-full bg-white border border-beige-darker px-4 py-3 font-mono text-sm text-black placeholder:text-ink-muted/50 outline-none focus:border-ink-muted transition-colors mb-6"
            />

            {authenticated && (
              <>
                <div className="mb-6">
                  <p className="font-mono text-[0.65rem] text-ink-muted tracking-widest uppercase mb-2">Policy enforcement</p>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { mode: 'backend' as const, label: 'backend', desc: 'fast setup, server enforced' },
                      { mode: 'onchain' as const, label: 'on-chain', desc: 'Solana policy account' },
                    ].map(option => (
                      <button
                        key={option.mode}
                        type="button"
                        onClick={() => setPolicyMode(option.mode)}
                        className={`text-left border p-4 transition-colors cursor-pointer ${
                          policyMode === option.mode
                            ? 'border-black bg-white'
                            : 'border-beige-darker bg-white/60 hover:border-ink-muted'
                        }`}
                      >
                        <span className="block font-mono text-xs text-black tracking-widest uppercase mb-1">{option.label}</span>
                        <span className="block font-mono text-[0.6rem] text-ink-muted leading-relaxed">{option.desc}</span>
                      </button>
                    ))}
                  </div>
                  {policyMode === 'onchain' && (
                    <p className="font-mono text-[0.6rem] text-ink-muted/70 mt-2 leading-relaxed">
                      creates registry, policy, and spend counter PDAs after the wallet is funded.
                    </p>
                  )}
                </div>

                <label className="bg-white border border-beige-darker p-4 mb-6 flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={privacyEnabled}
                    onChange={e => setPrivacyEnabled(e.target.checked)}
                    className="mt-[0.1rem] accent-black"
                  />
                  <span>
                    <span className="block font-mono text-xs text-black tracking-widest uppercase mb-1">private mode</span>
                    <span className="block font-mono text-[0.65rem] text-ink-muted leading-relaxed">
                      marks this agent private. Fund it, then register Umbra from the agent page.
                    </span>
                  </span>
                </label>
              </>
            )}

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
