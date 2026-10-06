import { getAddress, parseUnits } from 'viem'
import { PublicKey } from '@solana/web3.js'
import { localNetworks, parseChains } from './local-networks'

export type TransferInput = {
  wallet: string
  chain: string
  to: string
  amount: string
  asset?: string
  maxFee?: string
  key: string
}

export function exactAmount(value: string, decimals: number) {
  if (!/^\d+(\.\d+)?$/.test(value) || (value.split('.')[1]?.length ?? 0) > decimals) {
    throw Error(`Use a positive decimal amount with at most ${decimals} decimal places`)
  }
  const amount = parseUnits(value, decimals)
  if (amount <= 0n) throw Error('Amount must be positive')
  return amount
}

// Shared request construction only: no wallet files, credentials, signing or RPC.
export function transferTerms(input: TransferInput, allowEns = false) {
  if (!input.key?.trim() || input.key.length > 200) {
    throw Error('--key is required (1–200 characters); reuse it to check an uncertain send, never choose a new key blindly')
  }
  const chains = parseChains(input.chain)
  if (chains.length !== 1) throw Error('Choose exactly one --chain for a send')
  const chain = chains[0]!
  const network = localNetworks[chain]!
  const symbol = Object.keys(network.assets).find(key => key.toLowerCase() === (input.asset ?? network.defaultAsset).toLowerCase())
  if (!symbol) throw Error(`Supported assets on ${chain}: ${Object.keys(network.assets).join(', ')}`)
  const asset = network.assets[symbol]!
  const amountAtomic = exactAmount(input.amount, asset.decimals)
  const maxFee = input.maxFee ?? network.defaultFee
  // EVM gas (including Tempo) uses 18-decimal protocol units; Solana uses lamports.
  const maxFeeAtomic = exactAmount(maxFee, network.decimals)
  let to: string
  try {
    if (allowEns && input.to.includes('.')) to = input.to.trim()
    else to = network.family === 'solana' ? new PublicKey(input.to).toBase58() : getAddress(input.to)
  } catch {
    throw Error('Invalid recipient address for this chain')
  }
  return { chain, symbol, asset, amountAtomic, maxFee, maxFeeAtomic, to }
}
