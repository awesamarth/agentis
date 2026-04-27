'use client'

import { usePrivy } from '@privy-io/react-auth'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navbar from '@/components/Navbar'
import { Copy, Check, RefreshCw } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from 'recharts'

const API = process.env.NEXT_PUBLIC_BACKEND_URL

type TxRecord = {
  txHash: string
  amount: number      // SOL
  amountUsd: number   // USD
  recipient: string
  timestamp: string
}

type Agent = {
  id: string
  name: string
  walletAddress: string
  createdAt: string
  policy?: {
    killSwitch: boolean
    dailyLimit: number | null
  }
  transactions: TxRecord[]
}

const ACCENT = '#c8a96e'
const ACCENT2 = '#2a2620'
const MUTED = '#d9d0be'

const PIE_COLORS = [
  ACCENT,
  ACCENT2,
  '#8f7a50',
  '#b8955a',
  '#6b6459',
  '#d6c18a',
  '#4a4340',
  '#aeb9c8',
]

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
      className="ml-2 text-ink-muted/50 hover:text-ink-muted transition-colors cursor-pointer"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  )
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-ink px-3 py-2 font-mono text-xs text-ink shadow-[4px_4px_0_rgba(15,14,12,0.08)]">
      <p className="text-ink-muted mb-1 tracking-widest uppercase">{label}</p>
      <p className="text-ink">${Number(payload[0].value).toFixed(4)}</p>
    </div>
  )
}

function PieTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-beige-darker px-3 py-2 font-mono text-xs text-ink">
      <p className="text-ink-muted">{payload[0].name}</p>
      <p className="text-ink">${Number(payload[0].value).toFixed(4)}</p>
    </div>
  )
}

export default function ProfilePage() {
  const { ready, authenticated, user, getAccessToken } = usePrivy()
  const router = useRouter()

  const [agents, setAgents] = useState<Agent[]>([])
  const [accountKey, setAccountKey] = useState<string | null>(null)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [loadingKey, setLoadingKey] = useState(false)
  const [loadingAgents, setLoadingAgents] = useState(true)

  useEffect(() => {
    if (ready && !authenticated) router.replace('/dashboard')
  }, [ready, authenticated])

  useEffect(() => {
    if (!authenticated) return
    fetchAgents()
    fetchAccountKey()
  }, [authenticated])

  async function fetchAgents() {
    setLoadingAgents(true)
    try {
      const token = await getAccessToken()
      const res = await fetch(`${API}/agents`, {
        headers: { authorization: `Bearer ${token}` },
      })
      if (res.ok) setAgents(await res.json())
    } finally {
      setLoadingAgents(false)
    }
  }

  async function fetchAccountKey() {
    try {
      const token = await getAccessToken()
      const res = await fetch(`${API}/account/key`, {
        headers: { authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const { accountKey } = await res.json()
        setAccountKey(accountKey)
      }
    } catch {}
  }

  async function generateKey() {
    setLoadingKey(true)
    try {
      const token = await getAccessToken()
      const res = await fetch(`${API}/account/key`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const { accountKey } = await res.json()
        setNewKey(accountKey)
        setAccountKey(accountKey.slice(0, 13) + '••••••••' + accountKey.slice(-4))
      }
    } finally {
      setLoadingKey(false)
    }
  }

  // Derived stats
  const allTxns = agents.flatMap(a => (a.transactions ?? []).map(tx => ({ ...tx, agentName: a.name })))
  const totalSpend = allTxns.reduce((s, t) => s + (t.amountUsd ?? t.amount), 0)
  const activeAgents = agents.filter(a => !a.policy?.killSwitch).length

  // Bar chart — spend per day (last 14 days)
  const spendByDay = (() => {
    const map: Record<string, number> = {}
    const now = Date.now()
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now - i * 86400000)
      map[d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })] = 0
    }
    allTxns.forEach(tx => {
      const d = new Date(tx.timestamp)
      const key = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      if (key in map) map[key] += tx.amountUsd ?? tx.amount
    })
    return Object.entries(map).map(([date, amount]) => ({ date, amount }))
  })()

  // Pie chart — spend per agent. Keep the chart readable when there are many
  // low-spend agents by grouping the tail.
  const spendByAgentRaw = agents
    .map(a => ({
      name: a.name,
      value: (a.transactions ?? []).reduce((s, t) => s + (t.amountUsd ?? t.amount), 0),
    }))
    .filter(a => a.value > 0)
    .sort((a, b) => b.value - a.value)

  const spendByAgent = (() => {
    if (spendByAgentRaw.length <= 7) return spendByAgentRaw
    const head = spendByAgentRaw.slice(0, 7)
    const other = spendByAgentRaw.slice(7).reduce((sum, a) => sum + a.value, 0)
    return [...head, { name: 'other agents', value: other }]
  })()

  const identity = user?.google?.email
    ?? user?.github?.email
    ?? (user?.wallet?.address
      ? user.wallet.address.slice(0, 6) + '...' + user.wallet.address.slice(-4)
      : null)

  const identityFull = user?.google?.email
    ?? user?.github?.email
    ?? user?.wallet?.address
    ?? ''

  if (!ready || !authenticated) return null

  return (
    <div className="min-h-screen bg-beige">
      <Navbar showCrumb="profile" />

      <div className="max-w-4xl mx-auto px-8 py-12 space-y-10">

        {/* Identity */}
        <section>
          <p className="font-mono text-[0.6rem] tracking-widest text-ink-muted uppercase mb-4">identity</p>
          <div className="border border-beige-darker bg-white p-6 flex items-center gap-4">
            <div className="w-10 h-10 bg-black flex items-center justify-center font-serif text-beige text-lg font-black shrink-0">
              {(identity ?? '?')[0].toUpperCase()}
            </div>
            <div>
              <p className="font-mono text-sm text-ink flex items-center gap-1">
                {identity}
                {identityFull && <CopyButton text={identityFull} />}
              </p>
              <p className="font-mono text-[0.6rem] text-ink-muted tracking-widest mt-0.5">
                {user?.google ? 'google' : user?.github ? 'github' : 'solana wallet'}
              </p>
            </div>
          </div>
        </section>

        {/* Stats */}
        <section>
          <p className="font-mono text-[0.6rem] tracking-widest text-ink-muted uppercase mb-4">overview</p>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'total agents', value: agents.length },
              { label: 'active agents', value: activeAgents },
              { label: 'total spend', value: `$${totalSpend.toFixed(2)}` },
            ].map(s => (
              <div key={s.label} className="border border-beige-darker bg-white p-5">
                <p className="font-mono text-[0.6rem] tracking-widest text-ink-muted uppercase mb-2">{s.label}</p>
                <p className="font-serif text-2xl font-bold text-ink">{s.value}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Charts */}
        {allTxns.length > 0 && (
          <section className="space-y-6">
            <p className="font-mono text-[0.6rem] tracking-widest text-ink-muted uppercase">spend analytics</p>

            {/* Bar chart */}
            <div className="border border-beige-darker bg-white p-6">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <p className="font-mono text-xs text-ink-muted mb-1">daily spend — last 14 days</p>
                  <p className="font-mono text-[0.6rem] text-ink-muted/50 tracking-widest uppercase">
                    USD settled through Agentis
                  </p>
                </div>
                <p className="font-mono text-[0.65rem] text-ink-muted/60 tracking-widest uppercase">
                  total ${totalSpend.toFixed(2)}
                </p>
              </div>
              <div className="bg-beige/50 border border-beige-darker/70 px-3 pt-5 pb-2">
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={spendByDay} barSize={18} margin={{ top: 8, right: 14, left: 2, bottom: 8 }}>
                  <CartesianGrid
                    stroke="#d9d0be"
                    strokeDasharray="3 6"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="date"
                    tick={{ fontFamily: 'DM Mono', fontSize: 9, fill: '#6b6459' }}
                    axisLine={{ stroke: '#d9d0be' }}
                    tickLine={false}
                    interval={1}
                    dy={8}
                  />
                  <YAxis
                    tick={{ fontFamily: 'DM Mono', fontSize: 9, fill: '#6b6459' }}
                    axisLine={{ stroke: '#d9d0be' }}
                    tickLine={false}
                    width={58}
                    tickFormatter={(v) => `$${Number(v).toFixed(2)}`}
                  />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(200,169,110,0.12)' }} />
                  <Bar dataKey="amount" fill={ACCENT} radius={[5, 5, 0, 0]} minPointSize={3} />
                </BarChart>
              </ResponsiveContainer>
              </div>
            </div>

            {/* Pie chart — only if multiple agents with spend */}
            {spendByAgent.length > 1 && (
              <div className="border border-beige-darker bg-white p-6">
                <p className="font-mono text-xs text-ink-muted mb-6">spend by agent</p>
                <div className="grid grid-cols-[minmax(0,1fr)_260px] gap-6 items-center">
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie
                        data={spendByAgent}
                        cx="50%"
                        cy="50%"
                        innerRadius={64}
                        outerRadius={96}
                        minAngle={4}
                        paddingAngle={1}
                        startAngle={90}
                        endAngle={-270}
                        dataKey="value"
                      >
                        {spendByAgent.map((_, i) => (
                          <Cell
                            key={i}
                            fill={PIE_COLORS[i % PIE_COLORS.length]}
                            stroke="#ffffff"
                            strokeWidth={2}
                          />
                        ))}
                      </Pie>
                      <Tooltip content={<PieTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>

                  <div className="space-y-2">
                    {spendByAgent.map((agent, i) => {
                      const pct = totalSpend > 0 ? (agent.value / totalSpend) * 100 : 0
                      return (
                        <div key={agent.name} className="flex items-center gap-3 border border-beige-darker/70 bg-beige/40 px-3 py-2">
                          <span
                            className="h-3 w-3 shrink-0"
                            style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="font-mono text-[0.65rem] text-ink truncate">{agent.name}</p>
                            <p className="font-mono text-[0.55rem] text-ink-muted/60 tracking-widest uppercase">
                              ${agent.value.toFixed(4)} · {pct.toFixed(1)}%
                            </p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Account API Key */}
        <section>
          <p className="font-mono text-[0.6rem] tracking-widest text-ink-muted uppercase mb-4">account api key</p>
          <div className="border border-beige-darker bg-white p-6 space-y-4">
            <p className="font-mono text-[0.7rem] text-ink-muted leading-relaxed">
              Use this key with the Agentis MCP server. Grants access to create and manage agents programmatically.
            </p>

            {newKey ? (
              <div className="bg-beige border border-beige-darker p-4 space-y-2">
                <p className="font-mono text-[0.6rem] tracking-widest text-ink-muted uppercase">new key — copy now, won't be shown again</p>
                <div className="flex items-center gap-2">
                  <p className="font-mono text-xs text-ink break-all">{newKey}</p>
                  <CopyButton text={newKey} />
                </div>
              </div>
            ) : accountKey ? (
              <div className="flex items-center gap-3">
                <p className="font-mono text-sm text-ink tracking-wider">{accountKey}</p>
              </div>
            ) : (
              <p className="font-mono text-xs text-ink-muted">No key generated yet.</p>
            )}

            <button
              onClick={generateKey}
              disabled={loadingKey}
              className="flex items-center gap-2 font-mono text-xs tracking-widest border border-beige-darker px-4 py-2 text-ink-muted hover:border-ink-muted hover:text-ink transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw size={12} className={loadingKey ? 'animate-spin' : ''} />
              {accountKey ? 'regenerate key' : 'generate key'}
            </button>

            {accountKey && !newKey && (
              <p className="font-mono text-[0.6rem] text-ink-muted/60">
                Regenerating will invalidate the existing key immediately.
              </p>
            )}
          </div>
        </section>

      </div>
    </div>
  )
}
