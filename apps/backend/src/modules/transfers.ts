import { getAddress, isAddress } from 'viem'
import { PublicKey } from '@solana/web3.js'
import type { OperationInput } from '@agentis-hq/core/operations'
import { fail } from '../errors'

export function buildTransfer(input: OperationInput): OperationInput {
  if (input.chainId.startsWith('solana:')) {
    try { return { ...input, to: new PublicKey(input.to).toBase58() } }
    catch { fail(400, 'invalid_recipient', 'Invalid Solana recipient') }
  }
  if (input.asset !== 'native' && !input.asset.startsWith('erc20:')) fail(400, 'unsupported_asset', 'Expected an EVM asset')
  if (!isAddress(input.to, { strict: true })) fail(400, 'invalid_recipient', 'Invalid EVM recipient')
  return { ...input, to: getAddress(input.to), asset: input.asset === 'native' ? 'native' : `erc20:${getAddress(input.asset.slice(6))}` }
}
