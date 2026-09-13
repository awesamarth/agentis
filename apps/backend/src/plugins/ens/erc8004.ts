import { encodeFunctionData, parseAbi, type Address } from 'viem'
import { ensClient } from './contracts'

// Official ERC-8004 Sepolia deployment; never use the mainnet registry.
export const identityRegistry = '0x8004A818BFB912233c491871b3d84c89A494BD9e' as const
export const identityRegistryAbi = parseAbi([
  'function register(string agentURI) returns (uint256)', 'function ownerOf(uint256 agentId) view returns (address)',
  'function tokenURI(uint256 agentId) view returns (string)', 'function getAgentWallet(uint256 agentId) view returns (address)',
  'event Registered(uint256 indexed agentId,string agentURI,address indexed owner)',
  'event URIUpdated(uint256 indexed agentId,string newURI,address indexed updatedBy)',
])
export function registrationUri(name: string, description: string, wallet: Address, agentId?: string) {
  const document = { type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1', name, description, services: [{ name: 'ENS', endpoint: name, version: 'v2' }, { name: 'wallet', endpoint: `eip155:11155111:${wallet}` }], active: true, x402Support: true, supportedTrust: [], ...(agentId ? { registrations: [{ agentId, agentRegistry: `eip155:11155111:${identityRegistry}` }] } : {}) }
  return 'data:application/json;base64,' + Buffer.from(JSON.stringify(document)).toString('base64')
}
export function registrationCall(uri: string) {
  return { to: identityRegistry, value: 0n, data: encodeFunctionData({ abi: identityRegistryAbi, functionName: 'register', args: [uri] }) }
}
export async function registration(id: string) {
  const client = ensClient(), args = [BigInt(id)] as const
  const [owner, wallet, uri] = await Promise.all([
    client.readContract({ address: identityRegistry, abi: identityRegistryAbi, functionName: 'ownerOf', args }),
    client.readContract({ address: identityRegistry, abi: identityRegistryAbi, functionName: 'getAgentWallet', args }),
    client.readContract({ address: identityRegistry, abi: identityRegistryAbi, functionName: 'tokenURI', args }),
  ])
  return { registry: `eip155:11155111:${identityRegistry}`, agentId: id, owner, wallet, uri }
}
export function associationKey(id: string) {
  // ERC-7930: version(1), EIP-155 type(0), chain-reference length + minimal bytes, address length + bytes.
  return `agent-registration[0x0001000003aa36a714${identityRegistry.slice(2).toLowerCase()}][${id}]`
}
