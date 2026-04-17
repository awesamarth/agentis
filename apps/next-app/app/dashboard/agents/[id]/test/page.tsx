'use client'

import { usePrivy } from '@privy-io/react-auth'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Navbar from '@/components/Navbar'

const API = process.env.NEXT_PUBLIC_BACKEND_URL
const DEVNET_EXPLORER = 'https://explorer.solana.com/tx'

type LogEntry = {
  id: number
  type: 'success' | 'error' | 'info'
  message: string
  detail?: string
  timestamp: string
}

type Agent = {
  id: string
  name: string
  walletAddress: string
}

let logId = 0

export default function AgentTestConsole() {
  const { ready, authenticated, getAccessToken } = usePrivy()
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const [agent, setAgent] = useState<Agent | null>(null)
  const [solBalance, setSolBalance] = useState<number | null>(null)

  // Send SOL state
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [sending, setSending] = useState(false)

  // Log
  const [logs, setLogs] = useState<LogEntry[]>([])

  function addLog(type: LogEntry['type'], message: string, detail?: string) {
    const now = new Date()
    const timestamp = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setLogs(prev => [{ id: logId++, type, message, detail, timestamp }, ...prev])
  }

  useEffect(() => {
    if (!ready) return
    if (!authenticated) { router.push('/dashboard'); return }
    fetchAgent()
  }, [ready, authenticated, id])

  async function fetchAgent() {
    try {
      const token = await getAccessToken()
      if (!token) return
      const res = await fetch(`${API}/agents/${id}`, {
        headers: { authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      const data: Agent = await res.json()
      setAgent(data)
      addLog('info', `Loaded agent: ${data.name}`, data.walletAddress)
      fetchBalance(data.walletAddress)
    } catch (e) {
      addLog('error', 'Failed to load agent')
    }
  }

  async function fetchBalance(address: string) {
    try {
      const res = await fetch('https://api.devnet.solana.com', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'getBalance',
          params: [address, { commitment: 'confirmed' }]
        })
      })
      const data = await res.json()
      const sol = data.result.value / 1e9
      setSolBalance(sol)
      addLog('info', `Balance: ${sol.toFixed(4)} SOL`)
    } catch {
      addLog('error', 'Failed to fetch balance')
    }
  }

  async function handleSend() {
    if (!recipient.trim() || !amount || parseFloat(amount) <= 0) return
    setSending(true)
    addLog('info', `Sending ${amount} SOL → ${recipient.slice(0, 8)}...${recipient.slice(-6)}`)
    try {
      const token = await getAccessToken()
      const res = await fetch(`${API}/agents/${id}/send`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ to: recipient.trim(), amountSol: parseFloat(amount) }),
      })
      const data = await res.json()
      if (!res.ok) {
        addLog('error', `Transaction failed`, data.error ?? 'Unknown error')
      } else {
        addLog('success', `Transaction confirmed`, data.signature)
        setAmount('')
        // refresh balance
        if (agent) fetchBalance(agent.walletAddress)
      }
    } catch (e) {
      addLog('error', 'Request failed', String(e))
    } finally {
      setSending(false)
    }
  }

  function fillBurnAddress() {
    setRecipient('11111111111111111111111111111111')
  }

  const canSend = recipient.trim().length > 0 && parseFloat(amount) > 0 && !sending

  return (
    <main className="min-h-screen bg-beige">
      <Navbar showCrumb="dashboard" />

      <div className="max-w-5xl mx-auto px-12 py-16">

        {/* Header */}
        <button
          onClick={() => router.push(`/dashboard/agents/${id}`)}
          className="font-mono text-[0.65rem] text-ink-muted tracking-widest mb-8 hover:text-ink transition-colors cursor-pointer"
        >
          ← back to agent
        </button>

        <div className="flex items-start justify-between mb-10">
          <div>
            <h1 className="font-serif font-black text-4xl text-black tracking-tight mb-1">
              Test Console
              {agent && <span className="text-ink-muted font-serif font-normal text-2xl ml-3">/ {agent.name}</span>}
            </h1>
            <p className="font-mono text-[0.65rem] text-ink-muted tracking-widest">devnet · send transactions · inspect results</p>
          </div>

          {/* Balance badge */}
          <div className="text-right">
            <p className="font-mono text-[0.6rem] text-ink-muted tracking-widest uppercase mb-1">Balance</p>
            <div className="flex items-baseline gap-1.5 justify-end">
              <span className="font-mono text-2xl text-black font-medium">
                {solBalance !== null ? solBalance.toFixed(4) : '—'}
              </span>
              <span className="font-mono text-xs text-ink-muted">SOL</span>
            </div>
            <button
              onClick={() => agent && fetchBalance(agent.walletAddress)}
              className="font-mono text-[0.6rem] text-ink-muted/50 hover:text-ink-muted transition-colors cursor-pointer mt-0.5"
            >
              refresh ↻
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">

          {/* Left — actions */}
          <div className="flex flex-col gap-6">

            {/* Send SOL */}
            <div className="bg-white border border-beige-darker p-6">
              <h2 className="font-mono text-[0.65rem] text-ink-muted tracking-widest uppercase mb-5">Send SOL</h2>

              <div className="flex flex-col gap-4">
                <div>
                  <label className="font-mono text-[0.6rem] text-ink-muted tracking-widest uppercase block mb-1.5">Recipient Address</label>
                  <input
                    type="text"
                    value={recipient}
                    onChange={e => setRecipient(e.target.value)}
                    placeholder="Solana address..."
                    className="w-full bg-beige border border-beige-darker px-3 py-2.5 font-mono text-xs text-black placeholder:text-ink-muted/40 outline-none focus:border-ink-muted transition-colors"
                  />
                  <button
                    onClick={fillBurnAddress}
                    className="font-mono text-[0.6rem] text-ink-muted/50 hover:text-accent transition-colors cursor-pointer tracking-widest mt-1 text-left"
                  >
                    use burn address →
                  </button>
                </div>

                <div>
                  <label className="font-mono text-[0.6rem] text-ink-muted tracking-widest uppercase block mb-1.5">Amount (SOL)</label>
                  <div className="relative">
                    <input
                      type="number"
                      min={0}
                      step={0.001}
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && canSend && handleSend()}
                      placeholder="0.001"
                      className="w-full bg-beige border border-beige-darker px-3 py-2.5 font-mono text-xs text-black placeholder:text-ink-muted/40 outline-none focus:border-ink-muted transition-colors pr-12"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[0.6rem] text-ink-muted">SOL</span>
                  </div>
                  {solBalance !== null && parseFloat(amount) > solBalance && (
                    <p className="font-mono text-[0.6rem] text-red-400 mt-1">insufficient balance</p>
                  )}
                </div>

                <button
                  onClick={handleSend}
                  disabled={!canSend}
                  className="bg-black text-beige font-mono text-xs tracking-widest py-3 hover:bg-ink transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {sending ? 'sending...' : 'send transaction →'}
                </button>
              </div>
            </div>

            {/* Wallet info */}
            <div className="bg-white border border-beige-darker p-6">
              <h2 className="font-mono text-[0.65rem] text-ink-muted tracking-widest uppercase mb-4">Wallet</h2>
              <p className="font-mono text-[0.6rem] text-ink-muted tracking-widest uppercase mb-1">Address</p>
              <p className="font-mono text-xs text-black break-all">{agent?.walletAddress ?? '—'}</p>
              <p className="font-mono text-[0.6rem] text-ink-muted/50 mt-3">devnet · managed by Privy HSM</p>
            </div>

          </div>

          {/* Right — activity log */}
          <div className="bg-white border border-beige-darker flex flex-col" style={{ minHeight: '480px' }}>
            <div className="px-5 py-4 border-b border-beige-darker flex items-center justify-between">
              <h2 className="font-mono text-[0.65rem] text-ink-muted tracking-widest uppercase">Activity Log</h2>
              {logs.length > 0 && (
                <button
                  onClick={() => setLogs([])}
                  className="font-mono text-[0.6rem] text-ink-muted/40 hover:text-ink-muted transition-colors cursor-pointer"
                >
                  clear
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
              {logs.length === 0 ? (
                <div className="flex-1 flex items-center justify-center">
                  <p className="font-mono text-[0.65rem] text-ink-muted/40 tracking-widest">no activity yet</p>
                </div>
              ) : (
                logs.map(log => (
                  <div key={log.id} className="flex gap-3 items-start">
                    <span className="font-mono text-[0.6rem] text-ink-muted/50 shrink-0 mt-0.5">{log.timestamp}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`font-mono text-[0.6rem] shrink-0 ${
                          log.type === 'success' ? 'text-green-600' :
                          log.type === 'error' ? 'text-red-500' :
                          'text-ink-muted'
                        }`}>
                          {log.type === 'success' ? '✓' : log.type === 'error' ? '✗' : '·'}
                        </span>
                        <p className="font-mono text-xs text-black">{log.message}</p>
                      </div>
                      {log.detail && (
                        log.type === 'success' && log.detail.length > 20 ? (
                          <a
                            href={`${DEVNET_EXPLORER}/${log.detail}?cluster=devnet`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-[0.6rem] text-ink-muted/60 hover:text-ink-muted break-all transition-colors mt-0.5 block"
                          >
                            {log.detail.slice(0, 16)}...{log.detail.slice(-8)} ↗
                          </a>
                        ) : (
                          <p className="font-mono text-[0.6rem] text-ink-muted/60 break-all mt-0.5">{log.detail}</p>
                        )
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>
      </div>
    </main>
  )
}
