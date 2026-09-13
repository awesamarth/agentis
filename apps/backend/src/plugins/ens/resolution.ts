import { base58 } from '@scure/base'
import { getAddress, hexToBytes, namehash, parseAbi, zeroAddress } from 'viem'
import { ensClient, normalizedName, coinType, resolverAbi } from './contracts'
import { fail } from '../../errors'
import { supportedNetworks } from '../../modules/networks'

export async function resolveRecipient(raw: string, chainId: string) {
  if (!supportedNetworks.some(network => network.chainId === chainId)) fail(400, 'unsupported_network', 'Choose a configured testnet')
  const name = normalizedName(raw), client = ensClient(), node = namehash(name), type = coinType(chainId)
  const resolver = await client.getEnsResolver({ name })
  if (!resolver || resolver === zeroAddress) fail(404, 'name_not_found', 'Name has no resolver on Ethereum Sepolia')
  // Require an explicit network record, not the default EVM/ETH fallback. No offchain gateway fetches.
  const present = await client.readContract({ address: resolver, abi: parseAbi(['function hasAddr(bytes32 node,uint256 coinType) view returns (bool)']), functionName: 'hasAddr', args: [node, type] })
  if (!present) fail(404, 'address_missing', 'ENS name has no explicit address record for the selected network')
  const value = await client.readContract({ address: resolver, abi: resolverAbi, functionName: 'addr', args: [node, type] })
  const bytes = hexToBytes(value)
  if (bytes.every(byte => byte === 0) || bytes.length !== (chainId.startsWith('solana:') ? 32 : 20)) fail(400, 'invalid_ens_address', 'ENS returned an invalid payment address')
  return { name, chainId, address: chainId.startsWith('solana:') ? base58.encode(bytes) : getAddress(value), resolver, resolutionChainId: 'eip155:11155111', checkedAt: new Date().toISOString() }
}
