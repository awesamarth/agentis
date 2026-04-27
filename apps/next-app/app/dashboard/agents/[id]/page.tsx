'use client'

import { usePrivy } from '@privy-io/react-auth'
import { useSignAndSendTransaction, useWallets } from '@privy-io/react-auth/solana'
import { address } from '@solana/addresses'
import { getBase58Decoder } from '@solana/codecs-strings'
import { pipe } from '@solana/functional'
import { AccountRole, type Instruction } from '@solana/instructions'
import { createSolanaRpc } from '@solana/rpc'
import {
  appendTransactionMessageInstruction,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/transaction-messages'
import { compileTransaction, getTransactionEncoder } from '@solana/transactions'
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
  privacyEnabled?: boolean
  umbraStatus?: 'disabled' | 'pending' | 'registered' | 'failed'
  umbraRegisteredAt?: string
  umbraRegistrationSignatures?: string[]
  umbraError?: string
  policyMode?: 'backend' | 'onchain'
  onchainPolicy?: {
    initialized: boolean
    programId: string
    agent: string
    policy: string
    spendCounter: string
    initializedSignature?: string
    lastPolicySignature?: string
    lastSpendSignature?: string
  }
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

type UmbraStatus = {
  isRegistered?: boolean
  isAnonymousReady?: boolean
  umbra?: {
    state?: string
    isInitialised?: boolean
    isActiveForAnonymousUsage?: boolean
    isUserCommitmentRegistered?: boolean
    isUserAccountX25519KeyRegistered?: boolean
  }
}

type UmbraBalance = {
  state?: string
  balance?: string | null
  mint?: string
}

type UmbraScan = {
  counts?: {
    received: number
    selfBurnable: number
    publicSelfBurnable: number
    publicReceived: number
  }
}

type OnchainPolicyStatus = {
  exists?: boolean
  initialized?: boolean
  programId: string
  agent: string
  policyPda?: string
  spendCounterPda?: string
  policyConfig?: {
    killSwitch: boolean
    maxPerTxMicroUsd: string
    hourlyLimitMicroUsd: string
    dailyLimitMicroUsd: string
    monthlyLimitMicroUsd: string
    maxBudgetMicroUsd: string
  }
  spendCounterState?: {
    hourSpentMicroUsd: string
    daySpentMicroUsd: string
    monthSpentMicroUsd: string
    totalSpentMicroUsd: string
  }
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
const UMBRA_SOL_MINT = 'So11111111111111111111111111111111111111112'
const DEVNET_RPC = 'https://api.devnet.solana.com'
const SYSTEM_PROGRAM_ADDRESS = '11111111111111111111111111111111'
const LAMPORTS_PER_SOL = BigInt(1_000_000_000)

function parseSolAmountToLamports(value: string) {
  const trimmed = value.trim()
  if (!/^\d+(\.\d{0,9})?$/.test(trimmed)) {
    throw new Error('Enter a valid SOL amount, up to 9 decimal places.')
  }

  const [whole, fractional = ''] = trimmed.split('.')
  const lamports = BigInt(whole) * LAMPORTS_PER_SOL + BigInt(fractional.padEnd(9, '0'))
  if (lamports <= BigInt(0)) throw new Error('Enter an amount greater than 0 SOL.')
  return lamports
}

function getSystemTransferInstruction(source: string, destination: string, lamports: bigint): Instruction {
  const data = new Uint8Array(12)
  const view = new DataView(data.buffer)
  view.setUint32(0, 2, true)
  view.setBigUint64(4, lamports, true)

  return {
    programAddress: address(SYSTEM_PROGRAM_ADDRESS),
    accounts: [
      { address: address(source), role: AccountRole.WRITABLE_SIGNER },
      { address: address(destination), role: AccountRole.WRITABLE },
    ],
    data,
  }
}

function formatMicroUsd(value?: string) {
  if (!value) return '$0.00'
  const dollars = Number(BigInt(value)) / 1_000_000
  return `$${dollars.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

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
  const { ready, authenticated, getAccessToken, login, connectWallet } = usePrivy()
  const { ready: walletsReady, wallets } = useWallets()
  const { signAndSendTransaction } = useSignAndSendTransaction()
  const router = useRouter()
  const params = useParams()
  const id = params.id as string

  const [agent, setAgent] = useState<Agent | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const [solBalance, setSolBalance] = useState<number | null>(null)
  const [tokens, setTokens] = useState<TokenBalance[]>([])
  const [balanceLoading, setBalanceLoading] = useState(false)
  const [fundAmountSol, setFundAmountSol] = useState('0.1')
  const [fundingAgent, setFundingAgent] = useState(false)
  const [fundError, setFundError] = useState<string | null>(null)
  const [fundSignature, setFundSignature] = useState<string | null>(null)

  const [agentName, setAgentName] = useState('')
  const [editingName, setEditingName] = useState(false)
  const [policy, setPolicy] = useState<Policy>(DEFAULT_POLICY)
  const [domainInput, setDomainInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [copiedAddress, setCopiedAddress] = useState(false)
  const [privacyRegistering, setPrivacyRegistering] = useState(false)
  const [umbraLoading, setUmbraLoading] = useState(false)
  const [umbraWorking, setUmbraWorking] = useState<string | null>(null)
  const [umbraStatus, setUmbraStatus] = useState<UmbraStatus | null>(null)
  const [umbraBalance, setUmbraBalance] = useState<UmbraBalance | null>(null)
  const [umbraScan, setUmbraScan] = useState<UmbraScan | null>(null)
  const [umbraAmount, setUmbraAmount] = useState('1000000')
  const [umbraError, setUmbraError] = useState<string | null>(null)
  const [umbraMessage, setUmbraMessage] = useState<string | null>(null)
  const [onchainStatus, setOnchainStatus] = useState<OnchainPolicyStatus | null>(null)
  const [onchainLoading, setOnchainLoading] = useState(false)
  const [onchainInitializing, setOnchainInitializing] = useState(false)
  const [onchainError, setOnchainError] = useState<string | null>(null)

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
      if (data.privacyEnabled || data.umbraStatus === 'registered') {
        fetchUmbraSnapshot(data.apiKey)
      }
      if (data.policyMode === 'onchain') {
        fetchOnchainPolicy()
      }
    } finally {
      setLoading(false)
    }
  }

  async function umbraFetch<T>(path: string, init: RequestInit = {}, key = apiKey): Promise<T> {
    if (!key) throw new Error('Missing agent API key')

    const res = await fetch(`${API}/umbra${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        ...(init.headers as Record<string, string> ?? {}),
      },
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error((body as any).error ?? `Umbra request failed: ${path}`)
    return body as T
  }

  async function fetchUmbraSnapshot(key = apiKey) {
    if (!key) return
    setUmbraLoading(true)
    setUmbraError(null)
    try {
      const [status, balance, scan] = await Promise.all([
        umbraFetch<UmbraStatus>('/status', {}, key),
        umbraFetch<UmbraBalance>(`/balance?mint=${encodeURIComponent(UMBRA_SOL_MINT)}`, {}, key),
        umbraFetch<UmbraScan>('/scan', {}, key).catch(() => null),
      ])
      setUmbraStatus(status)
      setUmbraBalance(balance)
      if (scan) setUmbraScan(scan)
    } catch (err: any) {
      setUmbraError(err?.message ?? 'Failed to load Umbra state')
    } finally {
      setUmbraLoading(false)
    }
  }

  async function handleUmbraAction(action: 'deposit' | 'withdraw' | 'scan' | 'status') {
    setUmbraWorking(action)
    setUmbraError(null)
    setUmbraMessage(null)
    try {
      if (action === 'scan') {
        const scan = await umbraFetch<UmbraScan>('/scan')
        setUmbraScan(scan)
        setUmbraMessage('scan updated')
        return
      }

      if (action === 'status') {
        await fetchUmbraSnapshot()
        setUmbraMessage('Umbra state refreshed')
        return
      }

      const amount = umbraAmount.trim()
      if (!amount || BigInt(amount) <= BigInt(0)) {
        throw new Error('Enter a positive atomic amount')
      }

      const result = await umbraFetch<Record<string, unknown>>(`/${action}`, {
        method: 'POST',
        body: JSON.stringify({ amount, mint: UMBRA_SOL_MINT }),
      })
      const signature = result.callbackSignature ?? result.queueSignature
      setUmbraMessage(`${action} submitted${signature ? `: ${String(signature).slice(0, 12)}...` : ''}`)
      await Promise.all([
        fetchUmbraSnapshot(),
        agent ? fetchBalances(agent.walletAddress) : Promise.resolve(),
      ])
    } catch (err: any) {
      setUmbraError(err?.message ?? `Umbra ${action} failed`)
    } finally {
      setUmbraWorking(null)
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

      // Token balances via Solana devnet RPC (Jupiter portfolio API is mainnet-only)
      const KNOWN_TOKENS: Record<string, { symbol: string; name: string; usdPerUnit: number }> = {
        '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU': { symbol: 'USDC', name: 'USD Coin', usdPerUnit: 1 },
        'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': { symbol: 'USDT', name: 'Tether USD', usdPerUnit: 1 },
        '2u1tszSeqaGNBXyMBCBMHXHNsJL83PbkSbB5CmEZi69W': { symbol: 'USDG', name: 'USDG', usdPerUnit: 1 },
      }
      const tokenRes = await fetch('https://api.devnet.solana.com', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 2, method: 'getTokenAccountsByOwner',
          params: [address, { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }, { encoding: 'jsonParsed' }]
        })
      })
      const tokenData = await tokenRes.json()
      const walletTokens: TokenBalance[] = (tokenData.result?.value ?? [])
        .map((acc: any) => {
          const info = acc.account.data.parsed.info
          const known = KNOWN_TOKENS[info.mint]
          const uiAmount = info.tokenAmount.uiAmount ?? 0
          return {
            symbol: known?.symbol ?? info.mint.slice(0, 6),
            name: known?.name ?? info.mint.slice(0, 6),
            mint: info.mint,
            balance: info.tokenAmount.amount,
            uiAmount,
            usdValue: known ? uiAmount * known.usdPerUnit : null,
            logoURI: undefined,
          }
        })
        .filter((t: TokenBalance) => t.uiAmount > 0)
      setTokens(walletTokens)
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

  async function fetchOnchainPolicy() {
    if (!authenticated) return
    setOnchainLoading(true)
    setOnchainError(null)
    try {
      const token = await getAccessToken()
      if (!token) return
      const res = await fetch(`${API}/agents/${id}/policy/onchain`, {
        headers: { authorization: `Bearer ${token}` },
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? 'Failed to load on-chain policy')
      setOnchainStatus(body)
    } catch (err: any) {
      setOnchainError(err?.message ?? 'Failed to load on-chain policy')
    } finally {
      setOnchainLoading(false)
    }
  }

  async function handleFundAgent() {
    if (!agent) return
    setFundError(null)
    setFundSignature(null)

    if (!authenticated) {
      login()
      return
    }

    if (!walletsReady) {
      setFundError('Wallets are still loading. Try again in a second.')
      return
    }

    const wallet = wallets[0]
    if (!wallet) {
      connectWallet()
      return
    }

    setFundingAgent(true)
    try {
      const lamports = parseSolAmountToLamports(fundAmountSol)
      const rpc = createSolanaRpc(DEVNET_RPC as any)
      const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: 'finalized' }).send()
      const source = address(wallet.address)
      const destination = address(agent.walletAddress)
      const instruction = getSystemTransferInstruction(source, destination, lamports)
      const message = pipe(
        createTransactionMessage({ version: 0 }),
        tx => setTransactionMessageFeePayer(source, tx),
        tx => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
        tx => appendTransactionMessageInstruction(instruction, tx),
      )
      const unsignedTransaction = compileTransaction(message)
      const transactionBytes = new Uint8Array(getTransactionEncoder().encode(unsignedTransaction))
      const result = await signAndSendTransaction({
        wallet,
        transaction: transactionBytes,
        chain: 'solana:devnet',
        options: { commitment: 'confirmed' },
      })
      const signature = getBase58Decoder().decode(result.signature)
      setFundSignature(signature)
      await fetchBalances(agent.walletAddress)
    } catch (err: any) {
      setFundError(err?.message ?? 'Funding transaction failed.')
    } finally {
      setFundingAgent(false)
    }
  }

  async function handleInitializeOnchainPolicy() {
    if (!authenticated) return
    setOnchainInitializing(true)
    setOnchainError(null)
    try {
      const token = await getAccessToken()
      if (!token) return
      const res = await fetch(`${API}/agents/${id}/policy/onchain/initialize`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? 'On-chain initialization failed')
      setAgent(body)
      await fetchOnchainPolicy()
    } catch (err: any) {
      setOnchainError(err?.message ?? 'On-chain initialization failed')
    } finally {
      setOnchainInitializing(false)
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

  async function handleRegisterPrivacy() {
    if (!authenticated) return
    setPrivacyRegistering(true)
    try {
      const token = await getAccessToken()
      const res = await fetch(`${API}/agents/${id}/privacy/register`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })
      const updated = await res.json().catch(() => null)
      if (updated) {
        setAgent(updated)
        setApiKey(updated.apiKey ?? apiKey)
        await fetchUmbraSnapshot(updated.apiKey ?? apiKey)
      }
    } finally {
      setPrivacyRegistering(false)
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
          if (updated.policyMode === 'onchain') await fetchOnchainPolicy()
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
          <div className="mt-3 bg-white border border-beige-darker p-5">
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="font-mono text-[0.6rem] text-ink-muted tracking-widest uppercase block mb-2">
                  add funds to agent
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={fundAmountSol}
                  onChange={e => setFundAmountSol(e.target.value.replace(/[^\d.]/g, ''))}
                  className="w-full h-10.5 bg-white border border-beige-darker px-4 font-mono text-sm text-black placeholder:text-ink-muted/40 outline-none focus:border-ink-muted transition-colors"
                  placeholder="0.1"
                />
              </div>
              <button
                onClick={handleFundAgent}
                disabled={fundingAgent || !agent}
                className="bg-black text-beige font-mono text-xs tracking-widest px-5 h-[42px] hover:bg-ink transition-colors cursor-pointer disabled:opacity-40"
              >
                {fundingAgent ? 'funding...' : authenticated && wallets.length === 0 ? 'connect wallet' : 'fund'}
              </button>
            </div>
            <p className="font-mono text-[0.55rem] text-ink-muted/50 mt-1">
              sends SOL from your connected Privy wallet to this agent on devnet.
            </p>
            {(fundError || fundSignature) && (
              <p className={`font-mono text-[0.65rem] mt-3 break-all ${fundError ? 'text-red-700' : 'text-ink-muted'}`}>
                {fundError ?? `funded: ${fundSignature}`}
              </p>
            )}
          </div>
        </section>

        {/* On-chain policy */}
        {agent?.policyMode === 'onchain' && (
          <section className="mb-10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-mono text-[0.65rem] text-ink-muted tracking-widest uppercase">On-chain Policy</h2>
              <button
                onClick={fetchOnchainPolicy}
                disabled={onchainLoading}
                className="font-mono text-[0.6rem] text-ink-muted/50 tracking-widest hover:text-ink-muted transition-colors cursor-pointer disabled:opacity-40"
              >
                refresh ↻
              </button>
            </div>
            <div className="border border-[#c8b6ff] bg-[linear-gradient(115deg,#ffffff_0%,#ffffff_55%,#f6f1ff_100%)] p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-mono text-sm text-black">
                      {agent.onchainPolicy?.initialized ? 'On-chain policy initialized' : 'On-chain policy pending'}
                    </p>
                    <span className={`font-mono text-[0.55rem] tracking-widest uppercase border px-1.5 py-0.5 ${
                      agent.onchainPolicy?.initialized
                        ? 'text-[#6d4aff] border-[#c8b6ff] bg-[#f6f1ff]'
                        : 'text-ink-muted border-beige-darker bg-white/70'
                    }`}>
                      {agent.onchainPolicy?.initialized ? 'live' : 'needs init'}
                    </span>
                  </div>
                  <p className="font-mono text-[0.65rem] text-ink-muted leading-relaxed">
                    {agent.onchainPolicy?.initialized
                      ? 'Direct SOL sends include an Agentis policy-program check before the transfer.'
                      : 'Fund this wallet first, then initialize the policy PDAs on devnet.'}
                  </p>
                </div>
                {!agent.onchainPolicy?.initialized && (
                  <button
                    onClick={handleInitializeOnchainPolicy}
                    disabled={onchainInitializing}
                    className="font-mono text-xs tracking-widest text-beige bg-black px-4 py-2 hover:bg-ink transition-colors cursor-pointer disabled:opacity-40 shrink-0"
                  >
                    {onchainInitializing ? 'initializing...' : 'initialize'}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3 mt-5">
                <div className="bg-white/70 border border-[#c8b6ff]/70 px-4 py-3">
                  <p className="font-mono text-[0.55rem] text-ink-muted tracking-widest uppercase mb-1">today</p>
                  <p className="font-mono text-sm text-black">{formatMicroUsd(onchainStatus?.spendCounterState?.daySpentMicroUsd)}</p>
                  <p className="font-mono text-[0.55rem] text-ink-muted/60 tracking-widest uppercase">on-chain spend</p>
                </div>
                <div className="bg-white/70 border border-[#c8b6ff]/70 px-4 py-3">
                  <p className="font-mono text-[0.55rem] text-ink-muted tracking-widest uppercase mb-1">month</p>
                  <p className="font-mono text-sm text-black">{formatMicroUsd(onchainStatus?.spendCounterState?.monthSpentMicroUsd)}</p>
                  <p className="font-mono text-[0.55rem] text-ink-muted/60 tracking-widest uppercase">policy counter</p>
                </div>
                <div className="bg-white/70 border border-[#c8b6ff]/70 px-4 py-3">
                  <p className="font-mono text-[0.55rem] text-ink-muted tracking-widest uppercase mb-1">lifetime</p>
                  <p className="font-mono text-sm text-black">{formatMicroUsd(onchainStatus?.spendCounterState?.totalSpentMicroUsd)}</p>
                  <p className="font-mono text-[0.55rem] text-ink-muted/60 tracking-widest uppercase">total tracked</p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-3">
                {[
                  ['agent PDA', agent.onchainPolicy?.agent],
                  ['policy PDA', agent.onchainPolicy?.policy],
                  ['counter PDA', agent.onchainPolicy?.spendCounter],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <p className="font-mono text-[0.55rem] text-ink-muted tracking-widest uppercase mb-1">{label}</p>
                    <p className="font-mono text-[0.6rem] text-ink-muted truncate">{value ?? '—'}</p>
                  </div>
                ))}
              </div>

              {onchainError && (
                <p className="font-mono text-[0.65rem] text-red-700 mt-4 break-all">{onchainError}</p>
              )}
            </div>
          </section>
        )}

        {/* Privacy */}
        {(agent?.privacyEnabled || agent?.umbraStatus === 'registered') && (
          <section className="mb-10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-mono text-[0.65rem] text-ink-muted tracking-widest uppercase">Privacy</h2>
              {agent.umbraStatus === 'registered' && (
                <button
                  onClick={() => handleUmbraAction('status')}
                  disabled={umbraLoading || umbraWorking !== null}
                  className="font-mono text-[0.6rem] text-ink-muted/50 tracking-widest hover:text-ink-muted transition-colors cursor-pointer disabled:opacity-40"
                >
                  refresh ↻
                </button>
              )}
            </div>
            <div className={`border p-5 ${
              agent.umbraStatus === 'registered'
                ? 'border-[#b7cce5] bg-[linear-gradient(115deg,#ffffff_0%,#ffffff_58%,#eef6ff_100%)]'
                : agent.umbraStatus === 'failed'
                  ? 'bg-red-50 border-red-200'
                  : 'bg-white border-beige-darker'
            }`}>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-mono text-sm text-black mb-1">
                    Umbra {agent.umbraStatus === 'registered' ? 'registered' : agent.umbraStatus ?? 'pending'}
                  </p>
                  <p className="font-mono text-[0.65rem] text-ink-muted leading-relaxed">
                    {agent.umbraStatus === 'registered'
                      ? 'Confidential balances and private transfer primitives are enabled for this agent.'
                      : 'Fund this wallet with SOL, then register it with Umbra to enable private flows.'}
                  </p>
                  {agent.umbraError && (
                    <p className="font-mono text-[0.65rem] text-red-700 mt-3 break-all">{agent.umbraError}</p>
                  )}
                  {umbraStatus && (
                    <p className="font-mono text-[0.6rem] text-ink-muted/60 mt-3 tracking-widest uppercase">
                      on-chain: {umbraStatus.umbra?.state ?? 'unknown'} · anonymous {umbraStatus.isAnonymousReady ? 'ready' : 'not ready'}
                    </p>
                  )}
                </div>
                {agent.umbraStatus === 'registered' ? (
                  <span className="font-mono text-[0.6rem] tracking-widest uppercase border border-beige-darker px-2 py-1 text-ink-muted shrink-0">
                    private
                  </span>
                ) : (
                  <button
                    onClick={handleRegisterPrivacy}
                    disabled={privacyRegistering}
                    className="font-mono text-xs tracking-widest text-beige bg-black px-4 py-2 hover:bg-ink transition-colors cursor-pointer disabled:opacity-40 shrink-0"
                  >
                    {privacyRegistering ? 'registering...' : 'register Umbra'}
                  </button>
                )}
              </div>

              {agent.umbraStatus === 'registered' && (
                <div className="mt-6 pt-5 border-t border-beige-darker">
                  <div className="grid grid-cols-3 gap-3 mb-5">
                    <div className="bg-white/70 border border-[#b7cce5]/70 px-4 py-3">
                      <p className="font-mono text-[0.55rem] text-ink-muted tracking-widest uppercase mb-1">encrypted balance</p>
                      <p className="font-mono text-sm text-black">
                        {umbraLoading && !umbraBalance
                          ? 'loading...'
                          : umbraBalance?.balance ?? '0'}
                      </p>
                      <p className="font-mono text-[0.55rem] text-ink-muted/60 tracking-widest uppercase">
                        wSOL atomic units
                      </p>
                    </div>
                    <div className="bg-white/70 border border-[#b7cce5]/70 px-4 py-3">
                      <p className="font-mono text-[0.55rem] text-ink-muted tracking-widest uppercase mb-1">balance state</p>
                      <p className="font-mono text-sm text-black">{umbraBalance?.state ?? 'unknown'}</p>
                      <p className="font-mono text-[0.55rem] text-ink-muted/60 tracking-widest uppercase">
                        Umbra shared mode
                      </p>
                    </div>
                    <div className="bg-white/70 border border-[#b7cce5]/70 px-4 py-3">
                      <p className="font-mono text-[0.55rem] text-ink-muted tracking-widest uppercase mb-1">claimable UTXOs</p>
                      <p className="font-mono text-sm text-black">
                        {umbraScan
                          ? (umbraScan.counts?.publicReceived ?? 0) + (umbraScan.counts?.received ?? 0)
                          : '—'}
                      </p>
                      <p className="font-mono text-[0.55rem] text-ink-muted/60 tracking-widest uppercase">
                        received + publicReceived
                      </p>
                    </div>
                  </div>

                  <div>
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="flex-1 min-w-52">
                      <label className="font-mono text-[0.55rem] text-ink-muted tracking-widest uppercase block mb-1.5">
                        amount
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={umbraAmount}
                        onChange={e => setUmbraAmount(e.target.value.replace(/[^\d]/g, ''))}
                        className="w-full h-[46px] bg-beige border border-beige-darker px-3 font-mono text-xs text-black placeholder:text-ink-muted/40 outline-none focus:border-ink-muted transition-colors"
                        placeholder="1000000"
                      />
                      </div>
                      <button
                        onClick={() => handleUmbraAction('deposit')}
                        disabled={umbraWorking !== null || !umbraAmount}
                        className="bg-black text-beige font-mono text-xs tracking-widest px-5 h-[46px] hover:bg-ink transition-colors cursor-pointer disabled:opacity-40"
                      >
                        {umbraWorking === 'deposit' ? 'depositing...' : 'deposit'}
                      </button>
                      <button
                        onClick={() => handleUmbraAction('withdraw')}
                        disabled={umbraWorking !== null || !umbraAmount}
                        className="font-mono text-xs tracking-widest text-ink-muted border border-beige-darker px-5 h-[46px] hover:border-ink-muted transition-colors cursor-pointer disabled:opacity-40"
                      >
                        {umbraWorking === 'withdraw' ? 'withdrawing...' : 'withdraw'}
                      </button>
                      <button
                        onClick={() => handleUmbraAction('scan')}
                        disabled={umbraWorking !== null}
                        className="font-mono text-xs tracking-widest text-ink-muted border border-beige-darker px-5 h-[46px] hover:border-ink-muted transition-colors cursor-pointer disabled:opacity-40"
                      >
                        {umbraWorking === 'scan' ? 'scanning...' : 'scan'}
                      </button>
                    </div>
                    <p className="font-mono text-[0.55rem] text-ink-muted/50 mt-1">
                      atomic units. 1 SOL = 1,000,000,000.
                    </p>
                  </div>

                  {(umbraError || umbraMessage) && (
                    <p className={`font-mono text-[0.65rem] mt-4 break-all ${umbraError ? 'text-red-700' : 'text-ink-muted'}`}>
                      {umbraError ?? umbraMessage}
                    </p>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

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

        {/* Save */}
        <div className="flex items-center gap-4 mb-10">
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


      </div>
    </main>
  )
}
