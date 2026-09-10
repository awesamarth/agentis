import { erc20Abi, type Address } from 'viem'
import { PublicKey } from '@solana/web3.js'
import type { WalletRow } from '../db/schema'
import { supportedNetworks, evmClient } from './networks'
import { solanaConnection } from './solana'
import { quoteUsd } from './usd-budget'

// Display estimates only: never used for authorization or spending reservations.
export async function agentBalance(wallets: WalletRow[]) {
  const networks = await Promise.all(wallets.map(async wallet => {
    const network = supportedNetworks.find(network => network.chainId === wallet.chainId)
    if (!network) return { chainId: wallet.chainId, name: wallet.chainId, tokens: [], usdMicros: null, complete: false }
    const tokens = await Promise.all(network.assets.map(async asset => {
      let amountAtomic: string | null = null
      let usdMicros: string | null = null
      try {
        let amount: bigint
        if (network.chainType === 'solana') {
          const connection = solanaConnection()
          if (!(await connection.getGenesisHash()).startsWith(network.chainId.slice(7))) throw new Error('RPC network mismatch')
          const owner = new PublicKey(wallet.address)
          if (asset.id === 'native') {
            const balance = await connection.getBalance(owner)
            if (typeof balance === 'number' && !Number.isSafeInteger(balance)) throw new Error('Unsafe balance precision')
            amount = BigInt(balance)
          }
          else {
            const accounts = await connection.getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(asset.id.slice(4)) })
            amount = accounts.value.reduce((sum, account) => sum + BigInt(account.account.data.parsed.info.tokenAmount.amount), 0n)
          }
        } else {
          const client = evmClient(wallet.chainId)
          if (await client.getChainId() !== client.chain.id) throw new Error('RPC network mismatch')
          amount = asset.id === 'native'
            ? await client.getBalance({ address: wallet.address as Address })
            : await client.readContract({ address: asset.id.slice(6) as Address, abi: erc20Abi, functionName: 'balanceOf', args: [wallet.address as Address] })
        }
        if (amount < 0n) throw new Error('Invalid balance')
        amountAtomic = amount.toString()
        if (amount === 0n) usdMicros = '0'
        else {
          const quote = await quoteUsd({ chainId: wallet.chainId, asset: asset.id })
          usdMicros = (amount * BigInt(quote.assetPrice) / (10n ** BigInt(asset.decimals) * 1_000_000_000_000n)).toString()
        }
      } catch { /* Preserve a known token amount when only its price is unavailable. */ }
      return { asset: asset.id, symbol: asset.symbol, decimals: asset.decimals, amountAtomic, usdMicros }
    }))
    const known = tokens.filter(token => token.usdMicros !== null)
    return { chainId: network.chainId, name: network.name, tokens, usdMicros: known.length ? known.reduce((sum, token) => sum + BigInt(token.usdMicros!), 0n).toString() : null, complete: known.length === tokens.length }
  }))
  const known = networks.filter(network => network.usdMicros !== null)
  return {
    networks,
    usdMicros: known.length || !networks.length ? known.reduce((sum, network) => sum + BigInt(network.usdMicros!), 0n).toString() : null,
    complete: networks.every(network => network.complete),
    checkedAt: new Date().toISOString(),
  }
}
