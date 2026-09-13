import { createPublicClient, encodeFunctionData, getAddress, http, keccak256, parseAbi, stringToHex, toHex, zeroAddress, type Address } from 'viem'
import { namehash, normalize, packetToBytes } from 'viem/ens'
import { sepolia } from 'viem/chains'

// ENSv2 Sepolia beta deployment, pinned to the official contracts-v2 deployment manifest.
export const ens = { chainId: 11155111, ethRegistry: '0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2', factory: '0x10dc6333cdfe1fcef624c6e0a8221b91804cd7ef', registryImplementation: '0x624a25d67b59d587752ebec8dded8827dae52050', resolverImplementation: '0x9eae5c2730a7dd16bdd1dee6421a1b91e3b0365e' } as const
export const registryAbi = parseAbi([
  'function getState(uint256 anyId) view returns ((uint8 status,uint64 expiry,address latestOwner,uint256 tokenId,uint256 resource))',
  'function getSubregistry(string label) view returns (address)', 'function getResolver(string label) view returns (address)',
  'function register(string label,address owner,address registry,address resolver,uint256 roles,uint64 expiry) returns (uint256)',
  'function setSubregistry(uint256 anyId,address registry)', 'function setParent(address parent,string label)',
  'function initialize(address rootAccount,uint256 roleBitmap)', 'function roles(uint256 anyId,address account) view returns (uint256)',
])
export const resolverAbi = parseAbi([
  'event TextChanged(bytes32 indexed node,string indexed indexedKey,string key,string value)',
  'function addr(bytes32 node,uint256 coinType) view returns (bytes)', 'function text(bytes32 node,string key) view returns (string)',
  'function setAddr(bytes32 node,uint256 coinType,bytes value)', 'function setText(bytes32 node,string key,string value)',
  'function authorizeTextRoles(bytes name,string key,address account,bool grant)', 'function multicall(bytes[] calls) returns (bytes[])',
  'function roles(uint256 resource,address account) view returns (uint256)',
])
export const factoryAbi = parseAbi(['function deployProxy(address implementation,uint256 salt,bytes data) returns (address)', 'function verifyContract(address proxy) view returns (address)', 'event ProxyDeployed(address indexed sender,address indexed proxyAddress,uint256 salt,address implementation)'])
export const allRoles = BigInt('0x' + '1'.repeat(64))
export const recordKeys = { endpoint: 'org.agentis.endpoint', description: 'description' } as const
export const dnsName = (name: string) => toHex(packetToBytes(normalize(name)))
export const labelId = (label: string) => BigInt(keccak256(stringToHex(label)))
export const ensClient = () => createPublicClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com', { timeout: 15000, retryCount: 0 }), ccipRead: false })
export function normalizedName(name: string) {
  const result = normalize(name.trim())
  if (result.length > 255) throw Error('ENS name is too long')
  return result
}
export async function parentState(name: string) {
  const parent = normalizedName(name), parts = parent.split('.')
  if (parts.length !== 2 || parts[1] !== 'eth') throw Error('Choose an ENSv2 Sepolia .eth parent name')
  const client = ensClient(), label = parts[0]!
  const [state, registry, resolver] = await Promise.all([
    client.readContract({ address: ens.ethRegistry, abi: registryAbi, functionName: 'getState', args: [labelId(label)] }),
    client.readContract({ address: ens.ethRegistry, abi: registryAbi, functionName: 'getSubregistry', args: [label] }),
    client.readContract({ address: ens.ethRegistry, abi: registryAbi, functionName: 'getResolver', args: [label] }),
  ])
  if (state.status !== 2 || state.expiry * 1000n <= BigInt(Date.now())) throw Error('Parent is not registered on ENSv2 Sepolia')
  if (resolver === zeroAddress || (await client.readContract({ address: ens.factory, abi: factoryAbi, functionName: 'verifyContract', args: [resolver] })).toLowerCase() !== ens.resolverImplementation) throw Error('Parent must use the ENSv2 Permissioned Resolver')
  return { parent, label, owner: getAddress(state.latestOwner), expiry: state.expiry, registry, resolver }
}
export function coinType(chainId: string) {
  if (chainId === 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1') return 501n
  if (!/^eip155:\d+$/.test(chainId)) throw Error('Unsupported ENS address network')
  const id = BigInt(chainId.slice(7))
  if (id >= 0x80000000n) throw Error('Network has no ENSIP-11 coin type')
  return id === 1n ? 60n : 0x80000000n | id
}
export function textCall(name: string, key: keyof typeof recordKeys, value: string) {
  return encodeFunctionData({ abi: resolverAbi, functionName: 'setText', args: [namehash(normalizedName(name)), recordKeys[key], value] })
}
export async function canWriteText(name: string, resolver: Address, key: keyof typeof recordKeys, account: Address) {
  const node = namehash(name), part = keccak256(stringToHex(recordKeys[key]))
  const zero = '0x' + '0'.repeat(64)
  const resources = [0n, ...[[node, zero], [zero, part], [node, part]].map(([n, p]) => BigInt(keccak256((n! + p!.slice(2)) as `0x${string}`)))]
  const roles = await Promise.all(resources.map(resource => ensClient().readContract({ address: resolver, abi: resolverAbi, functionName: 'roles', args: [resource, account] })))
  return roles.some(role => (role & 16n) !== 0n)
}
