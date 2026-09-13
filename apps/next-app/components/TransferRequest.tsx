'use client'
import { usePrivy } from '@privy-io/react-auth'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AgentisClient } from '@agentis-hq/sdk'
import { parseAmount } from './amount-input'
import Dropdown from './Dropdown'

export default function TransferRequest() {
  const { ready, authenticated, user, getAccessToken } = usePrivy()
  const router = useRouter()
  const cache = useQueryClient()
  const [chainId, setChainId] = useState('')
  const [walletId, setWalletId] = useState('')
  const [assetId, setAssetId] = useState('')
  const attempt = useRef<{ body: string; key: string } | null>(null)
  const client = new AgentisClient({ baseUrl: process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001', token: async () => { const token = await getAccessToken(); if (!token) throw new Error('Sign in first'); return token } })
  const wallets = useQuery({ queryKey: ['wallets', user?.id], enabled: ready && authenticated, queryFn: () => client.wallets.list() })
  const networks = useQuery({ queryKey: ['onboarding', user?.id], enabled: ready && authenticated, queryFn: () => client.onboarding.get() })
  const agents = useQuery({ queryKey: ['agents', user?.id], enabled: ready && authenticated, queryFn: () => client.agents.list() })
  const available = wallets.data?.filter(wallet => wallet.enabled && networks.data?.networks.some(network => network.chainId === wallet.chainId && network.executionReady)) ?? []
  const availableNetworks = networks.data?.networks.filter(network => available.some(wallet => wallet.chainId === network.chainId)) ?? []
  const network = availableNetworks.find(network => network.chainId === chainId) ?? availableNetworks[0]
  const networkWallets = available.filter(wallet => wallet.chainId === network?.chainId)
  const selected = networkWallets.find(wallet => wallet.id === walletId) ?? networkWallets[0]
  const asset = network?.assets.find(asset => asset.id === assetId) ?? network?.assets[0]
  const submit = useMutation({ mutationFn: async (form: FormData) => {
    if (!selected || !network || !asset) throw new Error('Set up an enabled wallet first')
    const value = String(form.get('amount'))
    const input = { walletId: selected.id, chainId: selected.chainId, action: 'transfer' as const, asset: asset.id, to: String(form.get('to')), amountAtomic: parseAmount(value, asset.decimals).toString(), maxFeeAtomic: parseAmount(String(form.get('fee')), network.decimals).toString(), reason: String(form.get('reason')) }
    const body = JSON.stringify(input)
    if (attempt.current?.body !== body) attempt.current = { body, key: crypto.randomUUID() }
    return client.operations.create(input, { idempotencyKey: attempt.current.key })
  }, onSuccess: operation => { cache.invalidateQueries({ queryKey: ['operations'] }); router.push(`/operations/${operation.id}`) } })
  if (!authenticated || !available.length) return null
  const inputClass = 'mt-2 w-full border border-beige-darker bg-[#f8f4ed] p-3 font-mono text-sm'
  return <section className="border border-beige-darker p-6"><h2 className="font-serif text-2xl font-bold">Make a payment</h2><p className="mt-2 text-ink-muted">Request a testnet payment, then review and authorize it. Your wallet needs funds for the amount and network fee.</p>
    <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); submit.mutate(new FormData(event.currentTarget)) }}>
      <Dropdown label="Network" value={network?.chainId ?? ''} disabled={submit.isPending} onChange={value => { setChainId(value); setWalletId(''); setAssetId(''); submit.reset() }} options={availableNetworks.map(network => ({ value: network.chainId, label: network.name }))} />
      <Dropdown label="Agent wallet" value={selected?.id ?? ''} disabled={submit.isPending} onChange={setWalletId} options={networkWallets.map(wallet => ({ value: wallet.id, label: agents.data?.find(agent => agent.id === wallet.agentId)?.name ?? `Wallet ${wallet.id.slice(0, 8)}` }))} />
      <Dropdown label="Asset" value={asset?.id ?? ''} disabled={submit.isPending} onChange={setAssetId} options={network?.assets.map(asset => ({ value: asset.id, label: asset.symbol })) ?? []} />
      <label>Recipient address or ENS name<input key={network?.chainId} name="to" className={inputClass} required placeholder={network?.key === 'solana' ? 'Address or agent.yourname.eth' : '0x… or agent.yourname.eth'} /></label>
      <label>Amount ({asset?.symbol})<input key={`${network?.chainId}:${asset?.id}`} name="amount" className={inputClass} required inputMode="decimal" placeholder="0.00001" /></label>
      <label>Fee budget ({network?.currency})<input key={network?.key} name="fee" className={inputClass} required inputMode="decimal" defaultValue={network?.key === 'solana' ? '0.003' : ['base', 'sepolia'].includes(network?.key ?? '') ? '0.0001' : '0.01'} /></label>
      <label className="sm:col-span-2">What is this payment for? (optional)<input name="reason" className={inputClass} maxLength={500} /></label>
      {submit.error && <p role="alert" className="sm:col-span-2">{submit.error.message}</p>}
      <button disabled={submit.isPending} className="bg-black p-4 font-mono text-xs uppercase tracking-widest text-beige disabled:opacity-40 sm:col-span-2">{submit.isPending ? 'Requesting…' : 'Review payment'}</button>
    </form>
  </section>
}
