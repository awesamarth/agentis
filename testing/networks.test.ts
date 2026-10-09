import { describe, test, expect } from 'bun:test'
import { Keypair } from '@solana/web3.js'
import { Challenge } from 'mppx'
import { validateMpp } from '../apps/backend/src/modules/mpp'
import { networks, networkByKey, requireNetwork, sameEnvironment } from '@agentis-hq/core/networks'
import { buildSolanaTransfer } from '@agentis-hq/core/solana-transfer'
import { createPrivyExecutor } from '../apps/backend/src/providers/privy-executor'
import { validateX402 } from '../apps/backend/src/modules/x402'
import type { WalletRow } from '../apps/backend/src/db/schema'
import type { OperationInput } from '@agentis-hq/core/operations'

const address = '0x0000000000000000000000000000000000000011'
const wallet = (chainId: string) => ({ id: crypto.randomUUID(), chainId, enabled: true, address }) as WalletRow
const transfer = (chainId: string, asset = 'native'): OperationInput => ({ walletId: crypto.randomUUID(), chainId, action: 'transfer', asset, to: address, amountAtomic: '1', maxFeeAtomic: '100000' })
const executor = createPrivyExecutor('fixture', 'fixture', async () => { throw Error('No wallet-provider calls permitted') }, 'fixture')

describe('developer-owned network catalog', () => {
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
    for (const network of networks.filter(n => n.family === 'tempo')) {
      const expiresAt = new Date(Date.now() + 120_000).toISOString()
      const challenge = Challenge.serialize(Challenge.from({ secretKey: 'fixture-only', realm: 'example.com', method: 'tempo', intent: 'charge', expires: expiresAt, request: { amount: '1', currency: network.feeToken!, recipient: address, methodDetails: { chainId: network.chain!.id, feePayer: false, supportedModes: ['pull'] } } }))
      const input: OperationInput = { ...transfer(network.chainId, `erc20:${network.feeToken}`), action: 'paid_fetch', mpp: { url: 'https://example.com/paid', challenge, expiresAt, maxAmountAtomic: '1' } }
      expect(() => validateMpp(wallet(network.chainId), input)).not.toThrow()
      const other = networks.find(n => n.family === 'tempo' && n.testnet !== network.testnet)!
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
})
