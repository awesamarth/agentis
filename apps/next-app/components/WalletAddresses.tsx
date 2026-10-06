'use client'

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { groupWalletAddresses } from '@/lib/wallet-addresses'

function WalletAddress({ address }: { address: string }) {
  const [status, setStatus] = useState('')
  async function copy() {
    try { await navigator.clipboard.writeText(address); setStatus('Copied') }
    catch { setStatus('Couldn’t copy. Select the address to copy manually.') }
  }
  return <div className="mt-1"><div className="flex items-center gap-1"><p className="min-w-0 break-all font-mono text-xs">{address}</p><button type="button" onClick={copy} onBlur={() => setStatus('')} aria-label="Copy wallet address" title={status === 'Copied' ? 'Copied' : 'Copy address'} className="shrink-0 rounded p-0.5 text-ink-muted hover:bg-beige-dark hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2">{status === 'Copied' ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}</button></div><p role="status" className={status === 'Copied' ? 'sr-only' : 'text-xs text-ink-muted'}>{status}</p></div>
}

export default function WalletAddresses({ wallets, networks, compact = false }: {
  wallets: Parameters<typeof groupWalletAddresses>[0]
  networks: Parameters<typeof groupWalletAddresses>[1]
  compact?: boolean
}) {
  const groups = groupWalletAddresses(wallets, networks)
  if (!groups.length) return <p className="text-sm text-ink-muted">No enabled wallets.</p>
  return <div className={compact ? 'mt-3 space-y-4' : 'grid gap-4 sm:grid-cols-2'}>
    {groups.map(group => <div key={group.key} className={compact ? 'min-w-0' : 'min-w-0 border border-beige-darker bg-white p-5'}>
      <h3 className="mb-3 font-mono text-xs text-ink-muted">{group.label}</h3>
      <WalletAddress address={group.address} />
      <div className="mt-4 space-y-2">
        {([false, true, undefined] as const).map(testnet => {
          const supported = group.networks.filter(network => network.testnet === testnet)
          if (!supported.length) return null
          return <div key={String(testnet)} className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 font-mono text-[10px] uppercase tracking-wider text-ink-muted">{testnet === undefined ? 'Networks' : testnet ? 'Testnet' : 'Mainnet'}</span>
            {supported.map(network => <span key={network.chainId} className="border border-beige-darker px-2 py-1 text-xs text-ink-muted">{network.name}</span>)}
          </div>
        })}
      </div>
    </div>)}
  </div>
}
