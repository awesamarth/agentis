'use client'

import { usePrivy } from '@privy-io/react-auth'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Navbar from '@/components/Navbar'

type Policy = {
  hourlyLimit: number | null
  dailyLimit: number | null
  monthlyLimit: number | null
  maxBudget: number | null
  maxPerTx: number | null
  allowedDomains: string[]
  killSwitch: boolean
}

type Agent = {
  id: string
  name: string
  walletAddress: string
  apiKey: string
  createdAt: string
  policy?: Policy
}

type TxRecord = {
  txHash: string
  amount: number
  recipient: string
  timestamp: string
}

type TokenBalance = {
  symbol: string
  name: string
  mint: string
  balance: number
  uiAmount: number
  usdValue: number | null
  logoURI?: string
}

const DEFAULT_POLICY: Policy = {
  hourlyLimit: null,
  dailyLimit: null,
  monthlyLimit: null,
  maxBudget: null,
  maxPerTx: null,
  allowedDomains: [],
  killSwitch: false,
}

const API = process.env.NEXT_PUBLIC_BACKEND_URL

function LimitInput({
  label,
  sublabel,
  value,
  onChange,
}: {
  label: string
  sublabel: string
  value: number | null
  onChange: (v: number | null) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="font-mono text-[0.65rem] text-ink-muted tracking-widest uppercase">{label}</label>
      <p className="font-mono text-[0.6rem] text-ink-muted/60">{sublabel}</p>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-xs text-ink-muted">$</span>
        <input
          type="number"
          min={0}
          step={0.01}
          value={value ?? ''}
          onChange={e => onChange(e.target.value === '' ? null : parseFloat(e.target.value))}
          placeholder="unlimited"
          className="w-full bg-white border border-beige-darker pl-7 pr-4 py-2.5 font-mono text-sm text-black placeholder:text-ink-muted/40 outline-none focus:border-ink-muted transition-colors"
        />
      </div>
    </div>
  )
}

export default function AgentDetail() {
  const { ready, authenticated, getAccessToken } = usePrivy()
  const router = useRouter()
  const params = useParams()
  const id = params.id as string

  const [agent, setAgent] = useState<Agent | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const [solBalance, setSolBalance] = useState<number | null>(null)
  const [tokens, setTokens] = useState<TokenBalance[]>([])
  const [balanceLoading, setBalanceLoading] = useState(false)

  const [agentName, setAgentName] = useState('')
  const [editingName, setEditingName] = useState(false)
  const [policy, setPolicy] = useState<Policy>(DEFAULT_POLICY)
  const [domainInput, setDomainInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [copiedAddress, setCopiedAddress] = useState(false)

  const [apiKey, setApiKey] = useState<string | null>(null)
  const [apiKeyVisible, setApiKeyVisible] = useState(false)
  const [copiedKey, setCopiedKey] = useState(false)
  const [regenning, setRegenning] = useState(false)
  const [regenConfirm, setRegenConfirm] = useState(false)

  const [transactions, setTransactions] = useState<TxRecord[]>([])
  const [txLoading, setTxLoading] = useState(false)

  useEffect(() => {
    if (!ready) return
    if (authenticated) {
      fetchAgent()
    } else {
      // guest mode — load from localStorage
      try {
        const raw = localStorage.getItem('agentis_guest_agents')
        const guests = raw ? JSON.parse(raw) : []
        const found = guests.find((a: Agent) => a.id === id)
        if (found) {
          setAgent(found)
          setAgentName(found.name)
          setPolicy({ ...DEFAULT_POLICY, ...found.policy })
          setApiKey(found.apiKey)
          setTransactions((found as any).transactions ?? [])
          fetchBalances(found.walletAddress)
        } else {
          setNotFound(true)
        }
      } catch {
        setNotFound(true)
      } finally {
        setLoading(false)
      }
    }
  }, [ready, authenticated, id])

  async function fetchAgent() {
    setLoading(true)
    try {
      const token = await getAccessToken()
      if (!token) return
      const res = await fetch(`${API}/agents/${id}`, {
        headers: { authorization: `Bearer ${token}` },
      })
      if (res.status === 404) { setNotFound(true); return }
      if (!res.ok) return
      const data: Agent = await res.json()
      setAgent(data)
      setAgentName(data.name)
      setPolicy({ ...DEFAULT_POLICY, ...data.policy })
      setApiKey(data.apiKey)
      fetchBalances(data.walletAddress)
      fetchTransactions(token)
    } finally {
      setLoading(false)
    }
  }

  async function fetchBalances(address: string) {
    setBalanceLoading(true)
    try {
      // SOL balance via Solana devnet RPC
      const rpcRes = await fetch('https://api.devnet.solana.com', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'getBalance',
          params: [address, { commitment: 'confirmed' }]
        })
      })
      const rpcData = await rpcRes.json()
      setSolBalance(rpcData.result.value / 1e9)

      // Token balances via Jupiter portfolio API
      const res = await fetch(`https://lite-api.jup.ag/portfolio/v1/positions/${address}`)
      if (res.ok) {
        const data = await res.json()
        const walletTokens: TokenBalance[] = (data?.wallet_balances ?? [])
          .filter((t: any) => t.ui_amount > 0)
          .map((t: any) => ({
            symbol: t.symbol ?? t.mint?.slice(0, 6),
            name: t.name ?? t.symbol ?? 'Unknown',
            mint: t.mint,
            balance: t.amount,
            uiAmount: t.ui_amount,
            usdValue: t.value_usd ?? null,
            logoURI: t.logo_uri,
          }))
        setTokens(walletTokens)
      }
    } catch {
      // silently fail — balance is non-critical
    } finally {
      setBalanceLoading(false)
    }
  }

  async function fetchTransactions(token: string) {
    setTxLoading(true)
    try {
      const res = await fetch(`${API}/agents/${id}/transactions`, {
        headers: { authorization: `Bearer ${token}` },
      })
      if (res.ok) setTransactions(await res.json())
    } finally {
      setTxLoading(false)
    }
  }

  async function handleRegenKey() {
    if (!regenConfirm) { setRegenConfirm(true); return }
    setRegenning(true)
    setRegenConfirm(false)
    try {
      const token = await getAccessToken()
      const res = await fetch(`${API}/agents/${id}/regen-key`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setApiKey(data.apiKey)
        setApiKeyVisible(true)
      }
    } finally {
      setRegenning(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    try {
      if (authenticated) {
        const token = await getAccessToken()
        const res = await fetch(`${API}/agents/${id}`, {
          method: 'PATCH',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ name: agentName.trim() || agent?.name, policy }),
        })
        if (res.ok) {
          const updated = await res.json()
          setAgent(updated)
          setEditingName(false)
          setSaved(true)
          setTimeout(() => setSaved(false), 2500)
        }
      } else {
        // guest — save to localStorage
        const raw = localStorage.getItem('agentis_guest_agents')
        const guests = raw ? JSON.parse(raw) : []
        const idx = guests.findIndex((a: Agent) => a.id === id)
        if (idx !== -1) {
          guests[idx] = { ...guests[idx], name: agentName.trim() || agent?.name, policy }
          localStorage.setItem('agentis_guest_agents', JSON.stringify(guests))
          setAgent(guests[idx])
        }
        setEditingName(false)
        setSaved(true)
        setTimeout(() => setSaved(false), 2500)
      }
    } finally {
      setSaving(false)
    }
  }

  function copyAddress() {
    if (!agent) return
    navigator.clipboard.writeText(agent.walletAddress)
    setCopiedAddress(true)
    setTimeout(() => setCopiedAddress(false), 2000)
  }

  function addDomain() {
    const d = domainInput.trim().toLowerCase().replace(/^https?:\/\//, '')
    if (!d || policy.allowedDomains.includes(d)) { setDomainInput(''); return }
    setPolicy(p => ({ ...p, allowedDomains: [...p.allowedDomains, d] }))
    setDomainInput('')
  }

  function removeDomain(domain: string) {
    setPolicy(p => ({ ...p, allowedDomains: p.allowedDomains.filter(d => d !== domain) }))
  }

  if (!ready || loading) {
    return (
      <main className="min-h-screen bg-beige">
        <Navbar showCrumb="dashboard" />
        <div className="max-w-4xl mx-auto px-12 py-16">
          <p className="font-mono text-xs text-ink-muted tracking-widest">loading...</p>
        </div>
      </main>
    )
  }

  if (notFound) {
    return (
      <main className="min-h-screen bg-beige">
        <Navbar showCrumb="dashboard" />
        <div className="max-w-4xl mx-auto px-12 py-16">
          <p className="font-mono text-xs text-ink-muted tracking-widest">agent not found.</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-beige">
      <Navbar showCrumb="dashboard" />

      <div className="max-w-4xl mx-auto px-12 py-16">

        {/* Back + header */}
        <button
          onClick={() => router.push('/dashboard')}
          className="font-mono text-[0.65rem] text-ink-muted tracking-widest mb-8 hover:text-ink transition-colors cursor-pointer flex items-center gap-2"
        >
          ← back to agents
        </button>

        <div className="flex items-start justify-between mb-12">
          <div>
            {editingName ? (
              <input
                autoFocus
                type="text"
                value={agentName}
                onChange={e => setAgentName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') { setAgentName(agent?.name ?? ''); setEditingName(false) } }}
                onBlur={() => { setAgentName(agent?.name ?? ''); setEditingName(false) }}
                className="font-serif font-black text-4xl text-black tracking-tight bg-transparent border-b-2 border-ink outline-none mb-1 w-80"
              />
            ) : (
              <h1
                onClick={() => setEditingName(true)}
                className="font-serif font-black text-4xl text-black tracking-tight mb-1 cursor-text hover:opacity-70 transition-opacity"
                title="click to rename"
              >
                {agent?.name}
              </h1>
            )}
            <p className="font-mono text-[0.65rem] text-ink-muted tracking-widest">
              created {agent ? new Date(agent.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : ''}
              {!editingName && <span className="ml-3 opacity-40">· click name to rename</span>}
            </p>
          </div>
          <button
            onClick={() => router.push(`/dashboard/agents/${id}/test`)}
            className="font-mono text-xs tracking-widest text-ink-muted border border-beige-darker px-5 py-2.5 hover:border-ink-muted transition-colors cursor-pointer"
          >
            open test console →
          </button>
        </div>

        {/* Wallet info */}
        <section className="mb-10">
          <h2 className="font-mono text-[0.65rem] text-ink-muted tracking-widest uppercase mb-4">Wallet</h2>
          <div className="bg-white border border-beige-darker p-5 flex items-center justify-between gap-4">
            <div>
              <p className="font-mono text-[0.6rem] text-ink-muted tracking-widest uppercase mb-1">Solana Address</p>
              <p className="font-mono text-sm text-black">{agent?.walletAddress}</p>
            </div>
            <button
              onClick={copyAddress}
              className="font-mono text-xs tracking-widest text-ink-muted border border-beige-darker px-4 py-2 hover:border-ink-muted transition-colors cursor-pointer shrink-0"
            >
              {copiedAddress ? 'copied!' : 'copy'}
            </button>
          </div>
        </section>

        {/* API Key */}
        {authenticated && (
        <section className="mb-10">
          <h2 className="font-mono text-[0.65rem] text-ink-muted tracking-widest uppercase mb-4">API Key</h2>
          <div className="bg-white border border-beige-darker p-5">
            <p className="font-mono text-[0.6rem] text-ink-muted/70 mb-4">
              Use this key to authenticate the Agentis SDK. Keep it secret.
            </p>
            <div className="flex items-center gap-3 mb-3">
              <p className="font-mono text-sm text-black flex-1 break-all">
                {apiKeyVisible && apiKey ? apiKey : (apiKey ? apiKey.slice(0, 12) + '••••••••••••••••••••••••••••••••' : '—')}
              </p>
              <button
                onClick={() => setApiKeyVisible(v => !v)}
                className="font-mono text-xs tracking-widest text-ink-muted border border-beige-darker px-3 py-1.5 hover:border-ink-muted transition-colors cursor-pointer shrink-0"
              >
                {apiKeyVisible ? 'hide' : 'show'}
              </button>
              <button
                onClick={() => { navigator.clipboard.writeText(apiKey ?? ''); setCopiedKey(true); setTimeout(() => setCopiedKey(false), 2000) }}
                className="font-mono text-xs tracking-widest text-ink-muted border border-beige-darker px-3 py-1.5 hover:border-ink-muted transition-colors cursor-pointer shrink-0"
              >
                {copiedKey ? 'copied!' : 'copy'}
              </button>
            </div>
            <button
              onClick={handleRegenKey}
              disabled={regenning}
              className={`font-mono text-xs tracking-widest px-4 py-2 transition-colors cursor-pointer disabled:opacity-40 border ${
                regenConfirm
                  ? 'bg-black text-beige border-black hover:bg-ink'
                  : 'text-ink-muted border-beige-darker hover:border-ink-muted'
              }`}
            >
              {regenning ? 'regenerating...' : regenConfirm ? 'confirm regenerate — old key will stop working' : 'regenerate key'}
            </button>
            {regenConfirm && (
              <button
                onClick={() => setRegenConfirm(false)}
                className="font-mono text-xs tracking-widest text-ink-muted ml-3 cursor-pointer hover:text-ink transition-colors"
              >
                cancel
              </button>
            )}
          </div>
        </section>
        )}

        {/* Balances */}
        <section className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-mono text-[0.65rem] text-ink-muted tracking-widest uppercase">Balances</h2>
            {!balanceLoading && (
              <button
                onClick={() => agent && fetchBalances(agent.walletAddress)}
                className="font-mono text-[0.6rem] text-ink-muted/50 tracking-widest hover:text-ink-muted transition-colors cursor-pointer"
              >
                refresh ↻
              </button>
            )}
          </div>

          {balanceLoading ? (
            <div className="bg-white border border-beige-darker p-5">
              <p className="font-mono text-[0.65rem] text-ink-muted/50 tracking-widest">fetching balances...</p>
            </div>
          ) : (
            <div className="bg-white border border-beige-darker divide-y divide-beige-darker">
              {/* SOL row — always shown */}
              <div className="px-5 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#9945FF] to-[#14F195] flex items-center justify-center shrink-0">
                    <span className="font-mono text-[0.55rem] text-white font-bold">SOL</span>
                  </div>
                  <div>
                    <p className="font-mono text-sm text-black">Solana</p>
                    <p className="font-mono text-[0.6rem] text-ink-muted tracking-widest uppercase">SOL · devnet</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm text-black">
                    {solBalance !== null ? solBalance.toFixed(4) : '—'}
                  </p>
                  <p className="font-mono text-[0.6rem] text-ink-muted">SOL</p>
                </div>
              </div>

              {/* Token rows */}
              {tokens.length === 0 ? (
                <div className="px-5 py-4">
                  <p className="font-mono text-[0.65rem] text-ink-muted/50 tracking-widest">no other tokens</p>
                </div>
              ) : (
                tokens.map(t => (
                  <div key={t.mint} className="px-5 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {t.logoURI ? (
                        <img src={t.logoURI} alt={t.symbol} className="w-7 h-7 rounded-full shrink-0" />
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-beige-darker flex items-center justify-center shrink-0">
                          <span className="font-mono text-[0.55rem] text-ink-muted font-bold">{t.symbol?.slice(0, 3)}</span>
                        </div>
                      )}
                      <div>
                        <p className="font-mono text-sm text-black">{t.name}</p>
                        <p className="font-mono text-[0.6rem] text-ink-muted tracking-widest uppercase">{t.symbol} · {t.mint.slice(0, 4)}...{t.mint.slice(-4)}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-sm text-black">{t.uiAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })}</p>
                      {t.usdValue !== null && (
                        <p className="font-mono text-[0.6rem] text-ink-muted">${t.usdValue.toFixed(2)}</p>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </section>

        {/* Kill switch — prominent */}
        <section className="mb-10">
          <h2 className="font-mono text-[0.65rem] text-ink-muted tracking-widest uppercase mb-4">Kill Switch</h2>
          <div className={`border p-5 flex items-center justify-between transition-colors ${policy.killSwitch ? 'bg-black border-black' : 'bg-white border-beige-darker'}`}>
            <div>
              <p className={`font-mono text-sm font-medium mb-0.5 transition-colors ${policy.killSwitch ? 'text-beige' : 'text-black'}`}>
                {policy.killSwitch ? 'Agent is HALTED — all payments blocked' : 'Agent is active'}
              </p>
              <p className={`font-mono text-[0.6rem] tracking-widest transition-colors ${policy.killSwitch ? 'text-beige/50' : 'text-ink-muted'}`}>
                {policy.killSwitch ? 'toggle off to resume agent operations' : 'toggle to immediately stop all agent spending'}
              </p>
            </div>
            <button
              onClick={() => setPolicy(p => ({ ...p, killSwitch: !p.killSwitch }))}
              className={`font-mono text-xs tracking-widest px-5 py-2.5 transition-colors cursor-pointer border ${
                policy.killSwitch
                  ? 'bg-beige text-black border-beige hover:bg-beige-darker'
                  : 'bg-black text-beige border-black hover:bg-ink'
              }`}
            >
              {policy.killSwitch ? 'resume agent' : 'kill agent'}
            </button>
          </div>
        </section>

        {/* Spending limits */}
        <section className="mb-10">
          <h2 className="font-mono text-[0.65rem] text-ink-muted tracking-widest uppercase mb-4">Spending Limits</h2>
          <div className="bg-white border border-beige-darker p-6 grid grid-cols-2 gap-6">
            <LimitInput
              label="Hourly Limit"
              sublabel="Max spend per hour (rolling window)"
              value={policy.hourlyLimit}
              onChange={v => setPolicy(p => ({ ...p, hourlyLimit: v }))}
            />
            <LimitInput
              label="Daily Limit"
              sublabel="Max spend per calendar day (UTC)"
              value={policy.dailyLimit}
              onChange={v => setPolicy(p => ({ ...p, dailyLimit: v }))}
            />
            <LimitInput
              label="Monthly Budget"
              sublabel="Max spend per calendar month"
              value={policy.monthlyLimit}
              onChange={v => setPolicy(p => ({ ...p, monthlyLimit: v }))}
            />
            <LimitInput
              label="Total Budget Cap"
              sublabel="Lifetime max — agent stops when hit"
              value={policy.maxBudget}
              onChange={v => setPolicy(p => ({ ...p, maxBudget: v }))}
            />
            <div className="col-span-2">
              <LimitInput
                label="Max Per Transaction"
                sublabel="Single payment ceiling — any tx above this is rejected"
                value={policy.maxPerTx}
                onChange={v => setPolicy(p => ({ ...p, maxPerTx: v }))}
              />
            </div>
          </div>
        </section>

        {/* Domain whitelist */}
        <section className="mb-10">
          <h2 className="font-mono text-[0.65rem] text-ink-muted tracking-widest uppercase mb-4">Domain Whitelist</h2>
          <div className="bg-white border border-beige-darker p-6">
            <p className="font-mono text-[0.6rem] text-ink-muted/70 mb-4">
              If set, agent can only make payments to these domains. Leave empty to allow all.
            </p>

            {/* Add domain */}
            <div className="flex gap-3 mb-4">
              <input
                type="text"
                value={domainInput}
                onChange={e => setDomainInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addDomain()}
                placeholder="e.g. api.dune.com"
                className="flex-1 bg-beige border border-beige-darker px-4 py-2.5 font-mono text-sm text-black placeholder:text-ink-muted/40 outline-none focus:border-ink-muted transition-colors"
              />
              <button
                onClick={addDomain}
                className="font-mono text-xs tracking-widest text-ink-muted border border-beige-darker px-4 py-2.5 hover:border-ink-muted transition-colors cursor-pointer"
              >
                + add
              </button>
            </div>

            {/* Domain list */}
            {policy.allowedDomains.length === 0 ? (
              <p className="font-mono text-[0.65rem] text-ink-muted/50 tracking-widest">no restrictions — all domains allowed</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {policy.allowedDomains.map(d => (
                  <div key={d} className="flex items-center gap-2 bg-beige border border-beige-darker px-3 py-1.5">
                    <span className="font-mono text-xs text-ink">{d}</span>
                    <button
                      onClick={() => removeDomain(d)}
                      className="font-mono text-xs text-ink-muted hover:text-black transition-colors cursor-pointer"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Transaction History */}
        <section className="mb-10">
          <h2 className="font-mono text-[0.65rem] text-ink-muted tracking-widest uppercase mb-4">Transaction History</h2>
          {txLoading ? (
            <div className="bg-white border border-beige-darker p-5">
              <p className="font-mono text-[0.65rem] text-ink-muted/50 tracking-widest">loading...</p>
            </div>
          ) : transactions.length === 0 ? (
            <div className="bg-white border border-beige-darker p-5">
              <p className="font-mono text-[0.65rem] text-ink-muted/50 tracking-widest">no transactions yet</p>
            </div>
          ) : (
            <div className="bg-white border border-beige-darker divide-y divide-beige-darker">
              {[...transactions].reverse().map((tx, i) => (
                <div key={tx.txHash + i} className="px-5 py-3 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-0.5">
                      <span className="font-mono text-sm text-black font-medium">−{tx.amount} SOL</span>
                      <span className="font-mono text-[0.6rem] text-ink-muted/50">→</span>
                      <span className="font-mono text-xs text-ink-muted truncate">{tx.recipient.slice(0, 8)}...{tx.recipient.slice(-6)}</span>
                    </div>
                    <a
                      href={`https://explorer.solana.com/tx/${tx.txHash}?cluster=devnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[0.6rem] text-ink-muted/50 hover:text-ink-muted transition-colors"
                    >
                      {tx.txHash.slice(0, 12)}...{tx.txHash.slice(-8)} ↗
                    </a>
                  </div>
                  <p className="font-mono text-[0.6rem] text-ink-muted shrink-0">
                    {new Date(tx.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} {new Date(tx.timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Save */}
        <div className="flex items-center gap-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-black text-beige font-mono text-xs tracking-widest px-8 py-3 hover:bg-ink transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'saving...' : 'save policy'}
          </button>
          {saved && (
            <p className="font-mono text-[0.65rem] text-ink-muted tracking-widest animate-fade-up">
              policy saved.
            </p>
          )}
        </div>

      </div>
    </main>
  )
}
