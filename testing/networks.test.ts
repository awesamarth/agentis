import { describe, test, expect } from 'bun:test'
import { Keypair } from '@solana/web3.js'
import { Challenge } from 'mppx'
import { validateMpp } from '../apps/backend/src/modules/mpp'
import { networks, publicNetworks, defaultNetwork, networkByKey, requireNetwork, sameEnvironment } from '@agentis-hq/core/networks'
import { buildSolanaTransfer } from '@agentis-hq/core/solana-transfer'
import { transferTerms } from '../packages/cli/src/lib/local-send'
import { networkSelection } from '../apps/backend/src/modules/networks'
import { createPrivyExecutor } from '../apps/backend/src/providers/privy-executor'
import { validateX402 } from '../apps/backend/src/modules/x402'
import { agentBalances } from '../apps/backend/src/modules/balances'
import type { WalletRow } from '../apps/backend/src/db/schema'
import type { OperationInput } from '@agentis-hq/core/operations'

const address = '0x0000000000000000000000000000000000000011'
const wallet = (chainId: string) => ({ id: crypto.randomUUID(), chainId, enabled: true, address }) as WalletRow
const transfer = (chainId: string, asset = 'native'): OperationInput => ({ walletId: crypto.randomUUID(), chainId, action: 'transfer', asset, to: address, amountAtomic: '1', maxFeeAtomic: '100000' })
const executor = createPrivyExecutor('fixture', 'fixture', async () => { throw Error('No wallet-provider calls permitted') }, 'fixture')

describe('developer-owned network catalog', () => {
  test('mainnet defaults, unique network identities, JSON-safe metadata', () => {
    expect(defaultNetwork.chainId).toBe('eip155:8453')
    expect(defaultNetwork.testnet).toBe(false)
    expect(new Set(networks.map(n => n.key)).size).toBe(networks.length)
    expect(new Set(networks.map(n => n.chainId)).size).toBe(networks.length)
    expect(() => JSON.stringify(publicNetworks)).not.toThrow()
    for (const network of networks) {
      expect(network.assets.some(asset => asset.symbol === network.defaultAsset)).toBe(true)
      expect(network.chainType === 'solana' ? network.genesisHash?.slice(0, 32) === network.chainId.slice(7) : network.chain?.id === Number(network.chainId.slice(7))).toBe(true)
      expect(network.testnet || network.assets.every(asset => asset.priceId !== 'test-usd')).toBe(true)
    }
  })
  test('selection derives from the catalog and rejects duplicates/custom chains', () => {
    expect(networkSelection.safeParse({ networks: networks.map(n => n.key), defaultNetwork: 'base' }).success).toBe(true)
    expect(networkSelection.safeParse({ networks: ['base', 'base'], defaultNetwork: 'base' }).success).toBe(false)
    expect(networkSelection.safeParse({ networks: ['custom'], defaultNetwork: 'custom' }).success).toBe(false)
    expect(networkSelection.safeParse({ networks: ['solana'], defaultNetwork: 'base' }).success).toBe(false)
  })
  test('CLI construction uses the exact network token, fee units and chain ID', async () => {
    for (const network of networks) {
      const to = network.family === 'solana' ? (await Keypair.generate()).publicKey.toBase58() : address
      const result = transferTerms({ wallet: 'fixture', chain: network.key, to, amount: '0.001', asset: network.defaultAsset, key: 'fixture' })
      expect(result.asset.id).toBe(network.assets.find(asset => asset.symbol === network.defaultAsset)!.id)
      expect(result.maxFeeAtomic).toBeGreaterThan(0n)
    }
    expect(transferTerms({ wallet: 'fixture', chain: 'base', to: address, amount: '1', asset: 'USDC', key: 'fixture' }).asset.token).toBe('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')
    expect(sameEnvironment(networkByKey('base')!.chainId, networkByKey('tempo')!.chainId)).toBe(true)
    expect(sameEnvironment(networkByKey('base')!.chainId, networkByKey('base-sepolia')!.chainId)).toBe(false)
  })
  test('executor rejects cross-network wallets and wrong-environment tokens before provider access', () => {
    for (const network of networks) {
      const input = transfer(network.chainId, network.assets[0]!.id)
      executor.validate(wallet(network.chainId), input)
      expect(() => executor.validate(wallet('eip155:999999'), input)).toThrow()
    }
    expect(() => executor.validate(wallet('eip155:8453'), transfer('eip155:8453', networkByKey('base-sepolia')!.assets[1]!.id))).toThrow()
    expect(() => requireNetwork('eip155:999999')).toThrow()
  })
  test('retired networks reject new execution while preserving historical classification', () => {
    const network = networkByKey('ethereum')!, previous = network.enabled
    network.enabled = false
    try {
      expect(() => executor.validate(wallet(network.chainId), transfer(network.chainId))).toThrow('no longer available')
      expect(requireNetwork(network.chainId).chain!.id).toBe(1)
      expect(sameEnvironment(network.chainId, 'eip155:8453')).toBe(true)
    } finally { network.enabled = previous }
  })
  test('x402 validates mainnet domain, token, wallet and network exactly', () => {
    for (const network of networks.filter(n => n.x402?.domainName)) {
      const rail = network.x402!
      const input: OperationInput = { ...transfer(network.chainId, rail.asset), action: 'paid_fetch', amountAtomic: rail.scale.toString(), maxFeeAtomic: '0', payment: { url: 'https://example.com/paid', maxAmountAtomic: '1', requirements: { scheme: 'exact', network: network.chainId, asset: rail.token, amount: '1', payTo: address, maxTimeoutSeconds: 60, extra: { name: rail.domainName!, version: '2' } } } }
      expect(() => validateX402(wallet(network.chainId), input)).not.toThrow()
      expect(() => validateX402(wallet('eip155:999999'), input)).toThrow()
      input.payment!.requirements.extra = { name: 'wrong-domain', version: '2' }
      expect(() => validateX402(wallet(network.chainId), input)).toThrow()
    }
  })
  test('MPP rejects mismatched Tempo networks and fee tokens', () => {
    for (const network of networks.filter(n => n.mpp)) {
      const expiresAt = new Date(Date.now() + 120_000).toISOString()
      const challenge = Challenge.serialize(Challenge.from({ secretKey: 'fixture-only', realm: 'example.com', method: 'tempo', intent: 'charge', expires: expiresAt, request: { amount: '1', currency: network.feeToken!, recipient: address, methodDetails: { chainId: network.chain!.id, feePayer: false, supportedModes: ['pull'] } } }))
      const input: OperationInput = { ...transfer(network.chainId, network.assets[0]!.id), action: 'paid_fetch', mpp: { url: 'https://example.com/paid', challenge, expiresAt, maxAmountAtomic: '1' } }
      expect(() => validateMpp(wallet(network.chainId), input)).not.toThrow()
      const other = networks.find(n => n.mpp && n.testnet !== network.testnet)!
      expect(() => validateMpp(wallet(other.chainId), { ...input, chainId: other.chainId, asset: other.assets[0]!.id })).toThrow()
      expect(() => validateMpp(wallet(network.chainId), { ...input, asset: other.assets[0]!.id })).toThrow()
    }
  })
  test('Solana instructions bind the mint to the selected environment', async () => {
    const from = (await Keypair.generate()).publicKey.toBase58(), to = (await Keypair.generate()).publicKey.toBase58()
    for (const network of networks.filter(n => n.family === 'solana')) {
      const input = { ...transfer(network.chainId, network.assets[1]!.id), to }
      const tx = await buildSolanaTransfer(from, input, '11111111111111111111111111111111')
      expect(tx.instructions[1]!.keys[1]!.pubkey.toBase58()).toBe(network.x402!.token)
      const other = networks.find(n => n.family === 'solana' && n.testnet !== network.testnet)!
      await expect(buildSolanaTransfer(from, { ...input, asset: other.assets[1]!.id }, '11111111111111111111111111111111')).rejects.toThrow()
    }
  })
  test('disabled wallets cause no balance RPC or price requests', async () => {
    const originalFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = (() => { calls++; throw Error('No HTTP permitted') }) as typeof fetch
    try {
      const result = await agentBalances([{ id: 'fixture', wallets: networks.map(network => ({ ...wallet(network.chainId), enabled: false })) }])
      expect(result.fixture!.networks).toEqual([])
      expect(result.fixture!.usdMicros).toBe('0')
      expect(calls).toBe(0)
    } finally { globalThis.fetch = originalFetch }
  })
})
