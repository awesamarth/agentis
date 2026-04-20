'use client'

import { usePrivy } from '@privy-io/react-auth'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navbar from '@/components/Navbar'
import { Copy, Check, RefreshCw } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts'

const API = process.env.NEXT_PUBLIC_BACKEND_URL

type TxRecord = {
  txHash: string
  amount: number
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

const PIE_COLORS = [ACCENT, ACCENT2, '#a08650', '#6b6459', '#b8955a', '#4a4340']

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
    <div className="bg-white border border-beige-darker px-3 py-2 font-mono text-xs text-ink">
      <p className="text-ink-muted mb-1">{label}</p>
      <p className="text-ink">{Number(payload[0].value).toFixed(4)} SOL</p>
    </div>
  )
}

function PieTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-beige-darker px-3 py-2 font-mono text-xs text-ink">
      <p className="text-ink-muted">{payload[0].name}</p>
      <p className="text-ink">{Number(payload[0].value).toFixed(4)} SOL</p>
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
  const totalSpend = allTxns.reduce((s, t) => s + t.amount, 0)
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
      if (key in map) map[key] += tx.amount
    })
    return Object.entries(map).map(([date, amount]) => ({ date, amount }))
  })()

  // Pie chart — spend per agent
  const spendByAgent = agents
    .map(a => ({
      name: a.name,
      value: (a.transactions ?? []).reduce((s, t) => s + t.amount, 0),
    }))
    .filter(a => a.value > 0)

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
              { label: 'total spend', value: `${totalSpend.toFixed(4)} SOL` },
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
              <p className="font-mono text-xs text-ink-muted mb-6">daily spend — last 14 days</p>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={spendByDay} barSize={14}>
                  <XAxis
                    dataKey="date"
                    tick={{ fontFamily: 'DM Mono', fontSize: 9, fill: '#6b6459' }}
                    axisLine={false}
                    tickLine={false}
                    interval={2}
                  />
                  <YAxis
                    tick={{ fontFamily: 'DM Mono', fontSize: 9, fill: '#6b6459' }}
                    axisLine={false}
                    tickLine={false}
                    width={48}
                    tickFormatter={(v) => `${v.toFixed(3)}`}
                  />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f5f0e8' }} />
                  <Bar dataKey="amount" fill={ACCENT} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Pie chart — only if multiple agents with spend */}
            {spendByAgent.length > 1 && (
              <div className="border border-beige-darker bg-white p-6">
                <p className="font-mono text-xs text-ink-muted mb-6">spend by agent</p>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={spendByAgent}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {spendByAgent.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<PieTooltip />} />
                    <Legend
                      formatter={(value) => (
                        <span style={{ fontFamily: 'DM Mono', fontSize: '0.7rem', color: '#6b6459' }}>{value}</span>
                      )}
                    />
                  </PieChart>
                </ResponsiveContainer>
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
