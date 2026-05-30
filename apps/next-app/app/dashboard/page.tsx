'use client'

import { Copy, Check, Lock, Unlock, X, RefreshCw } from 'lucide-react'
import { usePrivy } from '@privy-io/react-auth'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import Link from 'next/link'
import Navbar from '@/components/Navbar'

type Agent = {
  id: string
  name: string
  walletAddress: string
  apiKey?: string
  apiKeyMasked?: string
  createdAt: string
  privacyEnabled?: boolean
  umbraStatus?: 'disabled' | 'pending' | 'registered' | 'failed'
  umbraError?: string
  policyMode?: 'backend' | 'onchain'
  onchainPolicy?: { initialized: boolean }
  _guest?: boolean
  _secretKeyBytes?: string  // JSON array of key bytes, only for guest agents
}

type EarnSweepAgent = {
  agent: Pick<Agent, 'id' | 'name' | 'walletAddress' | 'policyMode' | 'privacyEnabled'>
  usdcAtomic: string
  amountUi: string
  action: 'sweep' | 'skip'
}

type EarnSweepPlan = {
  network: 'mainnet'
  asset: 'USDC'
  totalAtomic: string
  totalUi: string
  agents: EarnSweepAgent[]
}

type EarnSweepDeposit = {
  agent: Pick<Agent, 'id' | 'name' | 'walletAddress'>
  amount: string
  ok: boolean
  skipped?: boolean
  error?: string
  result?: { signature?: string }
}

type EarnAccountPositionAgent = {
  agent: Pick<Agent, 'id' | 'name' | 'walletAddress' | 'policyMode' | 'privacyEnabled'>
  ok: boolean
  totalUnderlyingAtomic: string
  totalUnderlyingUi: string
  positions: unknown[]
  error?: string
}

type EarnAccountPositions = {
  network: 'mainnet'
  asset: 'USDC'
  totalUnderlyingAtomic: string
  totalUnderlyingUi: string
  agents: EarnAccountPositionAgent[]
}

const API = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'https://api.agentis.systems'
const GUEST_STORAGE_KEY = 'agentis_guest_agents'
const EARN_SWEEP_TIMEOUT_MS = 8000

function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false)
  function copy(e: React.MouseEvent) {
    e.preventDefault()
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

function getErrorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback
}

function formatEarnRowAmount(value: string | undefined) {
  const amount = Number(value ?? 0)
  if (!Number.isFinite(amount) || amount === 0) return '0'
  return amount.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}

export default function Dashboard() {
  const { ready, authenticated, getAccessToken, login } = usePrivy()
  const [agents, setAgents] = useState<Agent[]>([])
  const [balances, setBalances] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [agentName, setAgentName] = useState('')
  const [privacyEnabled, setPrivacyEnabled] = useState(false)
  const [policyMode, setPolicyMode] = useState<'backend' | 'onchain'>('backend')
  const [creating, setCreating] = useState(false)
  const [revealedKey, setRevealedKey] = useState<{ agentName: string; key: string } | null>(null)
  const [sweepPlan, setSweepPlan] = useState<EarnSweepPlan | null>(null)
  const [sweepDeposits, setSweepDeposits] = useState<EarnSweepDeposit[] | null>(null)
  const [sweepLoading, setSweepLoading] = useState(false)
  const [sweepExecuting, setSweepExecuting] = useState(false)
  const [sweepError, setSweepError] = useState<string | null>(null)
  const [earnPositions, setEarnPositions] = useState<EarnAccountPositions | null>(null)
  const [earnPositionsLoading, setEarnPositionsLoading] = useState(false)
  const [earnPositionsError, setEarnPositionsError] = useState<string | null>(null)
  const earnInitialLoadRef = useRef(false)
  const earnSnapshotInFlightRef = useRef<Promise<void> | null>(null)

  function getAgentCardClass(agent: Agent) {
    if (agent.policyMode === 'onchain') {
      return 'border-[#c8b6ff] bg-[linear-gradient(115deg,#ffffff_0%,#ffffff_62%,#f6f1ff_100%)]'
    }

    if (agent.privacyEnabled && agent.umbraStatus === 'registered') {
      return 'border-[#b7cce5] bg-[linear-gradient(115deg,#ffffff_0%,#ffffff_62%,#eef6ff_100%)]'
    }

    return 'border-beige-darker bg-white'
  }

  const fetchAllBalances = useEffectEvent(async (addresses: string[]) => {
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
  })

  const fetchAgents = useEffectEvent(async () => {
    const token = await getAccessToken()
    setLoading(true)
    try {
      const res = await fetch(`${API}/agents`, {
        headers: { authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      setAgents(data)
      setLoading(false)
      void fetchAllBalances(data.map((a: Agent) => a.walletAddress))
      if (!earnInitialLoadRef.current) {
        earnInitialLoadRef.current = true
        void fetchEarnSnapshot(token)
      }
    } finally {
      setLoading(false)
    }
  })

  useEffect(() => {
    if (!ready) return
    if (authenticated) {
      queueMicrotask(() => {
        void fetchAgents()
      })
    } else {
      queueMicrotask(() => {
        earnInitialLoadRef.current = false
        earnSnapshotInFlightRef.current = null
        setSweepPlan(null)
        setEarnPositions(null)
        const guests = loadGuestAgents()
        setAgents(guests)
        void fetchAllBalances(guests.map(a => a.walletAddress))
      })
    }
  }, [ready, authenticated])

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
        setRevealedKey({ agentName: agent.name, key: agent.apiKey })
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

  async function fetchSweepPlan(tokenInput?: string | null) {
    if (!authenticated) return
    setSweepLoading(true)
    setSweepError(null)
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), EARN_SWEEP_TIMEOUT_MS)
    try {
      const token = tokenInput ?? await getAccessToken()
      if (!token) return
      const res = await fetch(`${API}/agents/earn/sweep`, {
        headers: { authorization: `Bearer ${token}` },
        signal: controller.signal,
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? 'Failed to load Earn sweep plan')
      setSweepPlan(body)
    } catch (err: unknown) {
      setSweepError(
        err instanceof DOMException && err.name === 'AbortError'
          ? 'Jupiter Earn balance check timed out. Refresh to try again.'
          : getErrorMessage(err, 'Failed to load Earn sweep plan'),
      )
    } finally {
      window.clearTimeout(timeout)
      setSweepLoading(false)
    }
  }

  async function fetchEarnAccountPositions(tokenInput?: string | null) {
    if (!authenticated) return
    setEarnPositionsLoading(true)
    setEarnPositionsError(null)
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), EARN_SWEEP_TIMEOUT_MS)
    try {
      const token = tokenInput ?? await getAccessToken()
      if (!token) return
      const res = await fetch(`${API}/agents/earn/positions`, {
        headers: { authorization: `Bearer ${token}` },
        signal: controller.signal,
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? 'Failed to load Earn positions')
      setEarnPositions(body)
    } catch (err: unknown) {
      setEarnPositionsError(
        err instanceof DOMException && err.name === 'AbortError'
          ? 'Jupiter Earn positions timed out. Refresh to try again.'
          : getErrorMessage(err, 'Failed to load Earn positions'),
      )
    } finally {
      window.clearTimeout(timeout)
      setEarnPositionsLoading(false)
    }
  }

  async function fetchEarnSnapshot(tokenInput?: string | null) {
    if (earnSnapshotInFlightRef.current) return earnSnapshotInFlightRef.current

    const run = (async () => {
      const token = tokenInput ?? await getAccessToken()
      if (!token) return
      await fetchSweepPlan(token)
      await fetchEarnAccountPositions(token)
    })()

    earnSnapshotInFlightRef.current = run
    try {
      await run
    } finally {
      earnSnapshotInFlightRef.current = null
    }
  }

  async function executeSweep() {
    if (!authenticated) {
      login()
      return
    }
    setSweepExecuting(true)
    setSweepError(null)
    setSweepDeposits(null)
    try {
      const token = await getAccessToken()
      if (!token) return
      const res = await fetch(`${API}/agents/earn/sweep`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ network: 'mainnet', asset: 'USDC' }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? 'Earn sweep failed')
      setSweepDeposits(body.deposits ?? [])
      await fetchEarnSnapshot()
    } catch (err: unknown) {
      setSweepError(getErrorMessage(err, 'Earn sweep failed'))
    } finally {
      setSweepExecuting(false)
    }
  }

  const sweepableAgents = sweepPlan?.agents.filter(item => item.action === 'sweep') ?? []
  const suppliedAgents = earnPositions?.agents.filter(item => BigInt(item.totalUnderlyingAtomic || '0') > 0n) ?? []
  const earnRows = agents.map(agent => {
    const available = sweepPlan?.agents.find(item => item.agent.id === agent.id)
    const supplied = earnPositions?.agents.find(item => item.agent.id === agent.id)
    return { agent, available, supplied }
  })
  const earnLoading = sweepLoading || earnPositionsLoading
  const hasEarnSnapshot = Boolean(sweepPlan || earnPositions || sweepError || earnPositionsError)

  return (
    <main className="min-h-screen bg-beige">
      <Navbar showCrumb="dashboard" />

      <div className="max-w-5xl mx-auto px-12 py-16">

        {/* Guest banner */}
        {ready && !authenticated && (
          <div className="border border-beige-darker bg-white p-4 mb-8 flex items-center justify-between gap-4">
            <p className="font-mono text-[0.65rem] text-ink-muted tracking-widest">
              you&apos;re in guest mode — agents are saved locally and won&apos;t persist across devices
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
              <Link
                key={agent.id}
                href={`/dashboard/agents/${agent.id}`}
                className={`border p-6 flex items-center justify-between cursor-pointer hover:border-ink-muted hover:shadow-sm transition-all group ${getAgentCardClass(agent)}`}
              >
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-serif font-bold text-lg text-black group-hover:text-ink transition-colors">{agent.name}</p>
                    {agent._guest && (
                      <span className="font-mono text-[0.55rem] text-ink-muted border border-beige-darker px-1.5 py-0.5 tracking-widest">guest</span>
                    )}
                    {agent.policyMode === 'onchain' && (
                      <span className="font-mono text-[0.55rem] border px-1.5 py-0.5 tracking-widest text-[#6d4aff] border-[#c8b6ff] bg-[#f6f1ff]">
                        on-chain policy{agent.onchainPolicy?.initialized ? '' : ' pending'}
                      </span>
                    )}
                    {agent.privacyEnabled && agent.umbraStatus === 'registered' && (
                      <span className="font-mono text-[0.55rem] border border-[#b7cce5] bg-[#eef6ff] text-[#3f6f9f] px-1.5 py-0.5 tracking-widest inline-flex items-center gap-1">
                        <Lock
                          size={12}
                          strokeWidth={2}
                          className="text-[#3f6f9f] shrink-0 -translate-y-[0.65px]"
                          aria-label="private agent"
                        />
                        private
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
              </Link>
            ))}
          </div>
        )}

        {ready && authenticated && agents.length > 0 && (
          <section className="mt-10 border border-[#b8d8c0] bg-[linear-gradient(115deg,#ffffff_0%,#ffffff_64%,#eefaf0_100%)] p-5">
            <div className="flex items-start justify-between gap-5">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <img src="/jupiter-logo.png" alt="" className="h-5 w-5 rounded-full" />
                  <h2 className="font-mono text-sm text-black tracking-widest uppercase">Jupiter Earn</h2>
                </div>
                <p className="font-mono text-[0.65rem] text-ink-muted leading-relaxed">
                  Mainnet USDC across hosted agents can be deposited into Jupiter Earn from here.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => { void fetchEarnSnapshot() }}
                  disabled={earnLoading || sweepExecuting}
                  className="font-mono text-[0.6rem] text-ink-muted border border-[#b8d8c0] bg-white/60 px-3 h-9 hover:border-[#79aa86] transition-colors cursor-pointer disabled:opacity-40 inline-flex items-center gap-1.5"
                >
                  <RefreshCw size={12} className={earnLoading ? 'animate-spin' : ''} />
                  refresh
                </button>
                <button
                  onClick={executeSweep}
                  disabled={sweepExecuting || sweepLoading || sweepableAgents.length === 0}
                  className="bg-black text-beige font-mono text-xs tracking-widest px-5 h-9 hover:bg-ink transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {sweepExecuting ? 'sweeping...' : 'sweep USDC'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 mt-5">
              <div className="bg-white/75 border border-[#b8d8c0]/80 px-4 py-3">
                <p className="font-mono text-[0.55rem] text-ink-muted tracking-widest uppercase mb-1">supplied</p>
                <p className="font-mono text-sm text-black">{earnPositionsLoading && !earnPositions ? 'loading...' : `${earnPositions?.totalUnderlyingUi ?? '--'} USDC`}</p>
              </div>
              <div className="bg-white/75 border border-[#b8d8c0]/80 px-4 py-3">
                <p className="font-mono text-[0.55rem] text-ink-muted tracking-widest uppercase mb-1">available</p>
                <p className="font-mono text-sm text-black">{sweepLoading && !sweepPlan ? 'loading...' : `${sweepPlan?.totalUi ?? '--'} USDC`}</p>
              </div>
              <div className="bg-white/75 border border-[#b8d8c0]/80 px-4 py-3">
                <p className="font-mono text-[0.55rem] text-ink-muted tracking-widest uppercase mb-1">agents</p>
                <p className="font-mono text-sm text-black">
                  {hasEarnSnapshot ? `${suppliedAgents.length} supplied · ${sweepableAgents.length} with USDC` : 'refresh to load'}
                </p>
              </div>
            </div>

            {(sweepPlan || earnPositions) && (
              <div className="mt-4 border-t border-[#b8d8c0]/80 pt-3 space-y-2">
                {earnRows.slice(0, 5).map(item => (
                  <div key={item.agent.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4">
                    <div className="min-w-0">
                      <p className="font-mono text-xs text-black truncate">{item.agent.name}</p>
                      <p className="font-mono text-[0.55rem] text-ink-muted/60 truncate">{item.agent.walletAddress}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-mono text-[0.55rem] text-ink-muted/60 tracking-widest uppercase">supplied</p>
                      <p className="font-mono text-[0.65rem] text-[#2f7b46]">{formatEarnRowAmount(item.supplied?.totalUnderlyingUi)} USDC</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-mono text-[0.55rem] text-ink-muted/60 tracking-widest uppercase">available</p>
                      <p className={`font-mono text-[0.65rem] ${item.available?.action === 'sweep' ? 'text-black' : 'text-ink-muted/50'}`}>
                        {formatEarnRowAmount(item.available?.amountUi)} USDC
                      </p>
                    </div>
                  </div>
                ))}
                {earnRows.length > 5 && (
                  <p className="font-mono text-[0.55rem] text-ink-muted/50 tracking-widest uppercase">
                    + {earnRows.length - 5} more agents
                  </p>
                )}
              </div>
            )}

            {(sweepError || earnPositionsError || sweepDeposits) && (
              <div className="mt-4 border-t border-[#b8d8c0]/80 pt-3">
                {sweepError || earnPositionsError ? (
                  <div className="space-y-1.5">
                    {sweepError && <p className="font-mono text-[0.65rem] text-red-700 break-all">{sweepError}</p>}
                    {earnPositionsError && <p className="font-mono text-[0.65rem] text-red-700 break-all">{earnPositionsError}</p>}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {sweepDeposits?.filter(item => !item.skipped).map(item => (
                      <p key={item.agent.id} className={`font-mono text-[0.65rem] break-all ${item.ok ? 'text-ink-muted' : 'text-red-700'}`}>
                        {item.agent.name}: {item.ok ? `deposited ${item.amount} USDC${item.result?.signature ? ` · ${item.result.signature.slice(0, 12)}...` : ''}` : item.error}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
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

      {/* One-time API key modal */}
      {revealedKey && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-6"
          onClick={() => setRevealedKey(null)}
        >
          <div
            className="bg-beige border border-beige-darker p-7 w-full max-w-xl shadow-[10px_10px_0_rgba(0,0,0,0.08)]"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-6 mb-5">
              <div>
                <p className="font-mono text-[0.6rem] text-ink-muted tracking-widest uppercase mb-2">one-time api key</p>
                <h2 className="font-serif font-black text-2xl text-black">Save this key now.</h2>
                <p className="font-mono text-[0.7rem] text-ink-muted tracking-widest mt-2">
                  agent: <span className="text-black">{revealedKey.agentName}</span>
                </p>
              </div>
              <button
                onClick={() => setRevealedKey(null)}
                className="text-ink-muted hover:text-black transition-colors cursor-pointer"
                aria-label="close API key modal"
              >
                <X size={18} />
              </button>
            </div>

            <p className="font-mono text-[0.7rem] text-ink-muted leading-relaxed mb-5">
              Agentis stores only a hash. This full key won&apos;t be shown again after you close this modal.
            </p>

            <div className="bg-white border border-beige-darker p-4 mb-5">
              <p className="font-mono text-xs text-black break-all">{revealedKey.key}</p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(revealedKey.key)
                  setRevealedKey(null)
                }}
                className="bg-black text-beige font-mono text-xs tracking-widest px-5 py-3 hover:bg-ink transition-colors cursor-pointer"
              >
                copy & close
              </button>
              <button
                onClick={() => setRevealedKey(null)}
                className="font-mono text-xs tracking-widest text-ink-muted border border-beige-darker px-5 py-3 hover:border-ink-muted transition-colors cursor-pointer"
              >
                close
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
