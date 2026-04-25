'use client'

import { usePrivy } from '@privy-io/react-auth'
import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Navbar from '@/components/Navbar'

const API = process.env.NEXT_PUBLIC_BACKEND_URL
const DEVNET_RPC = 'https://api.devnet.solana.com'
const DEVNET_EXPLORER = 'https://explorer.solana.com/tx'
const GUEST_STORAGE_KEY = 'agentis_guest_agents'
const BURN_ADDRESS = '5yDpyuSofQARocCtzkrHaEeRjSBTuYTPPna1aeZjqUB6'

type LogEntry = {
  id: number
  type: 'success' | 'error' | 'info'
  message: string
  detail?: string
  timestamp: string
}

type Policy = {
  hourlyLimit: number | null
  dailyLimit: number | null
  monthlyLimit: number | null
  maxBudget: number | null
  maxPerTx: number | null
  allowedDomains: string[]
  killSwitch: boolean
}

type TxRecord = {
  txHash: string
  amount: number
  recipient: string
  timestamp: string
}

type GuestAgent = {
  id: string
  name: string
  walletAddress: string
  _guest: true
  _secretKeyBytes: string  // JSON array of key bytes
  policy?: Policy
  transactions?: TxRecord[]
}

type AuthAgent = {
  id: string
  name: string
  walletAddress: string
}

export default function AgentTestConsole() {
  const { ready, authenticated, getAccessToken } = usePrivy()
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const [agent, setAgent] = useState<AuthAgent | GuestAgent | null>(null)
  const [isGuest, setIsGuest] = useState(false)
  const [solBalance, setSolBalance] = useState<number | null>(null)

  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [sending, setSending] = useState(false)

  const [logs, setLogs] = useState<LogEntry[]>([])
  const logIdRef = useRef(0)
  const logEndRef = useRef<HTMLDivElement>(null)
  const leftColRef = useRef<HTMLDivElement>(null)
  const [logHeight, setLogHeight] = useState(0)

  useEffect(() => {
    if (!leftColRef.current) return
    const observer = new ResizeObserver(() => {
      if (leftColRef.current) setLogHeight(leftColRef.current.offsetHeight)
    })
    observer.observe(leftColRef.current)
    return () => observer.disconnect()
  }, [])

  function addLog(type: LogEntry['type'], message: string, detail?: string) {
    const now = new Date()
    const timestamp = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setLogs(prev => [...prev, { id: logIdRef.current++, type, message, detail, timestamp }])
    setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }

  useEffect(() => {
    if (!ready) return
    if (authenticated) {
      setIsGuest(false)
      fetchAuthAgent()
    } else {
      setIsGuest(true)
      loadGuestAgent()
    }
  }, [ready, authenticated, id])

  async function fetchAuthAgent() {
    try {
      const token = await getAccessToken()
      if (!token) return
      const res = await fetch(`${API}/agents/${id}`, {
        headers: { authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      const data: AuthAgent = await res.json()
      setAgent(data)
      addLog('info', `Loaded agent: ${data.name}`, data.walletAddress)
      fetchBalance(data.walletAddress)
    } catch {
      addLog('error', 'Failed to load agent')
    }
  }

  function loadGuestAgent() {
    try {
      const raw = localStorage.getItem(GUEST_STORAGE_KEY)
      const guests: GuestAgent[] = raw ? JSON.parse(raw) : []
      const found = guests.find(a => a.id === id)
      if (!found) {
        addLog('error', 'Guest agent not found')
        return
      }
      if (!found._secretKeyBytes) {
        addLog('error', 'No keypair found — this agent was created before keypair storage was added. Please create a new agent.')
        return
      }
      setAgent(found)
      addLog('info', `Loaded guest agent: ${found.name}`, found.walletAddress)
      fetchBalance(found.walletAddress)
    } catch {
      addLog('error', 'Failed to load guest agent')
    }
  }

  async function fetchBalance(address: string) {
    try {
      const res = await fetch(DEVNET_RPC, {
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

  // Guest-side policy enforcement (mirrors backend logic)
  function checkGuestPolicy(guestAgent: GuestAgent, amountSol: number): string | null {
    const policy = guestAgent.policy
    if (!policy) return null

    if (policy.killSwitch) return 'Kill switch is active — agent payments disabled'
    if (policy.maxPerTx !== null && amountSol > policy.maxPerTx) {
      return `Exceeds max per transaction limit (${policy.maxPerTx} SOL)`
    }

    const txns = guestAgent.transactions ?? []
    const now = Date.now()

    if (policy.hourlyLimit !== null) {
      const hourSpend = txns
        .filter(t => now - new Date(t.timestamp).getTime() < 60 * 60 * 1000)
        .reduce((sum, t) => sum + t.amount, 0)
      if (hourSpend + amountSol > policy.hourlyLimit) {
        return `Hourly spend limit exceeded (${policy.hourlyLimit} SOL)`
      }
    }

    if (policy.dailyLimit !== null) {
      const daySpend = txns
        .filter(t => now - new Date(t.timestamp).getTime() < 24 * 60 * 60 * 1000)
        .reduce((sum, t) => sum + t.amount, 0)
      if (daySpend + amountSol > policy.dailyLimit) {
        return `Daily spend limit exceeded (${policy.dailyLimit} SOL)`
      }
    }

    if (policy.monthlyLimit !== null) {
      const currentMonth = new Date().toISOString().slice(0, 7)
      const monthSpend = txns
        .filter(t => t.timestamp.slice(0, 7) === currentMonth)
        .reduce((sum, t) => sum + t.amount, 0)
      if (monthSpend + amountSol > policy.monthlyLimit) {
        return `Monthly spend limit exceeded (${policy.monthlyLimit} SOL)`
      }
    }

    if (policy.maxBudget !== null) {
      const totalSpend = txns.reduce((sum, t) => sum + t.amount, 0)
      if (totalSpend + amountSol > policy.maxBudget) {
        return `Total budget cap exceeded (${policy.maxBudget} SOL)`
      }
    }

    return null
  }

  function recordGuestTransaction(txHash: string, amountSol: number, to: string) {
    try {
      const raw = localStorage.getItem(GUEST_STORAGE_KEY)
      const guests: GuestAgent[] = raw ? JSON.parse(raw) : []
      const idx = guests.findIndex(a => a.id === id)
      if (idx === -1) return
      if (!guests[idx]!.transactions) guests[idx]!.transactions = []
      guests[idx]!.transactions!.push({
        txHash,
        amount: amountSol,
        recipient: to,
        timestamp: new Date().toISOString(),
      })
      localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(guests))
      // also update local state so policy checks are fresh
      setAgent(prev => {
        if (!prev || !isGuest) return prev
        const g = prev as GuestAgent
        return {
          ...g,
          transactions: [...(g.transactions ?? []), { txHash, amount: amountSol, recipient: to, timestamp: new Date().toISOString() }]
        }
      })
    } catch {
      // non-critical
    }
  }

  async function sendAsGuest(guestAgent: GuestAgent, to: string, amountSol: number) {
    const {
      address,
      createSolanaClient,
      createTransaction,
      sendAndConfirmTransactionWithSignersFactory,
    } = await import('gill')
    const { getTransferSolInstruction } = await import('@solana-program/system')
    const { createKeyPairSignerFromBytes } = await import('@solana/signers')

    // Reconstruct signer from stored byte array
    const keyArray: number[] = JSON.parse(guestAgent._secretKeyBytes)
    const keyBytes = new Uint8Array(keyArray)
    const signer = await createKeyPairSignerFromBytes(keyBytes)

    const { rpc, rpcSubscriptions } = createSolanaClient({ urlOrMoniker: 'devnet' })
    const sendAndConfirm = sendAndConfirmTransactionWithSignersFactory({ rpc, rpcSubscriptions })

    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send()

    const transaction = createTransaction({
      version: 'legacy',
      feePayer: signer,
      instructions: [
        getTransferSolInstruction({
          source: signer,
          destination: address(to),
          amount: Math.round(amountSol * 1e9),
        }),
      ],
      latestBlockhash,
    })

    const signature = await sendAndConfirm(transaction, { commitment: 'confirmed' })
    return String(signature)
  }

  async function handleSend() {
    if (!recipient.trim() || !amount || parseFloat(amount) <= 0 || !agent) return
    const amountSol = parseFloat(amount)
    setSending(true)
    addLog('info', `Sending ${amount} SOL → ${recipient.slice(0, 8)}...${recipient.slice(-6)}`)

    try {
      if (isGuest) {
        const guestAgent = agent as GuestAgent

        // Client-side policy check
        const policyError = checkGuestPolicy(guestAgent, amountSol)
        if (policyError) {
          addLog('error', `Policy rejected`, policyError)
          return
        }

        addLog('info', 'Policy check passed — signing in browser...')
        const signature = await sendAsGuest(guestAgent, recipient.trim(), amountSol)
        recordGuestTransaction(signature, amountSol, recipient.trim())
        addLog('success', 'Transaction sent', signature)
        setAmount('')
        pollConfirmation(signature)
      } else {
        // Authenticated — backend handles signing + policy
        const token = await getAccessToken()
        const res = await fetch(`${API}/agents/${id}/send`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ to: recipient.trim(), amountSol }),
        })
        const data = await res.json()
        if (!res.ok) {
          addLog('error', 'Transaction failed', data.error ?? 'Unknown error')
        } else {
          addLog('success', 'Transaction sent', data.signature)
          setAmount('')
          pollConfirmation(data.signature)
        }
      }
    } catch (e: any) {
      addLog('error', 'Transaction failed', e?.message ?? String(e))
    } finally {
      setSending(false)
    }
  }

  function pollConfirmation(sig: string) {
    const poll = async () => {
      try {
        const r = await fetch(DEVNET_RPC, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', id: 1,
            method: 'getSignatureStatuses',
            params: [[sig], { searchTransactionHistory: true }]
          })
        })
        const d = await r.json()
        const status = d.result?.value?.[0]
        if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
          if (agent) fetchBalance(agent.walletAddress)
        } else {
          setTimeout(poll, 1000)
        }
      } catch {
        // silent
      }
    }
    poll()
  }

  const canSend = recipient.trim().length > 0 && parseFloat(amount) > 0 && !sending && !!agent

  return (
    <main className="min-h-screen bg-beige">
      <Navbar showCrumb="dashboard" />

      <div className="max-w-5xl mx-auto px-12 py-16">

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
            <p className="font-mono text-[0.65rem] text-ink-muted tracking-widest">
              devnet · send transactions · inspect results
              {isGuest && <span className="ml-3 text-amber-600/70">· guest mode — signing in browser</span>}
            </p>
          </div>

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

        <div className="flex gap-6 items-start">

          <div className="flex flex-col gap-6 w-1/2" ref={leftColRef}>

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
                    onClick={() => setRecipient(BURN_ADDRESS)}
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

            <div className="bg-white border border-beige-darker p-6">
              <h2 className="font-mono text-[0.65rem] text-ink-muted tracking-widest uppercase mb-4">Wallet</h2>
              <p className="font-mono text-[0.6rem] text-ink-muted tracking-widest uppercase mb-1">Address</p>
              <p className="font-mono text-xs text-black break-all">{agent?.walletAddress ?? '—'}</p>
              <p className="font-mono text-[0.6rem] text-ink-muted/50 mt-3">
                {isGuest ? 'devnet · local keypair (browser)' : 'devnet · managed by Privy HSM'}
              </p>
            </div>

          </div>

          <div className="bg-white border border-beige-darker flex flex-col w-1/2" style={{ height: logHeight || undefined }}>
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

            <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-2">
              {logs.length === 0 ? (
                <div className="flex-1 flex items-center justify-center">
                  <p className="font-mono text-[0.65rem] text-ink-muted/40 tracking-widest">no activity yet</p>
                </div>
              ) : (
                <>
                  {logs.map(log => (
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
                  ))}
                  <div ref={logEndRef} />
                </>
              )}
            </div>
          </div>

        </div>
      </div>
    </main>
  )
}
