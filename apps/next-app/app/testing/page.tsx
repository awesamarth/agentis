'use client'

import { usePrivy, useWallets } from '@privy-io/react-auth'
import { useState } from 'react'

export default function TestingPage() {
  const { ready, connectWallet } = usePrivy()
  const { wallets } = useWallets()
  const [address, setAddress] = useState('')
  const [result, setResult] = useState('')
  const [busy, setBusy] = useState(false)
  const wallet = wallets.find(item => item.address === address) ?? wallets[0]

  async function checkCapabilities() {
    if (!wallet) return
    setBusy(true)
    setResult('')
    try {
      const provider = await wallet.getEthereumProvider()
      const capabilities = await provider.request({
        method: 'wallet_getCapabilities',
        params: [wallet.address, ['0xaa36a7']],
      })
      setResult(JSON.stringify(capabilities, null, 2) ?? 'No result returned')
    } catch (error) {
      const failure = error as { code?: unknown; message?: unknown }
      setResult(JSON.stringify({ error: typeof failure.message === 'string' ? failure.message : 'Capability request failed', code: typeof failure.code === 'number' || typeof failure.code === 'string' ? failure.code : undefined }, null, 2))
    } finally {
      setBusy(false)
    }
  }

  return <main className="mx-auto max-w-2xl space-y-4 px-6 py-12">
    <h1 className="font-serif text-2xl font-bold">Wallet batching test</h1>
    <p className="text-sm text-ink-muted">Calls wallet_getCapabilities for Ethereum Sepolia. No transaction or signature.</p>
    <button className="border border-beige-darker px-4 py-2" disabled={!ready || busy} onClick={() => connectWallet()}>Connect wallet</button>
    {wallet && <label className="block text-sm">Connected wallet
      <select className="mt-2 block w-full border border-beige-darker bg-beige p-2" value={wallet.address} disabled={busy} onChange={event => setAddress(event.target.value)}>
        {wallets.map(item => <option key={`${item.walletClientType}-${item.address}`} value={item.address}>{item.walletClientType} · {item.address}</option>)}
      </select>
    </label>}
    <button className="block bg-black px-4 py-2 text-beige disabled:opacity-40" disabled={!wallet || busy} onClick={checkCapabilities}>{busy ? 'Checking…' : 'Check Sepolia capabilities'}</button>
    {result && <pre aria-live="polite" className="overflow-auto border border-beige-darker p-4 text-xs whitespace-pre-wrap break-all">{result}</pre>}
  </main>
}
