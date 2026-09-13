import { encodeFunctionData, getAddress, namehash, parseEventLogs, type Address, type TransactionReceipt } from 'viem'
import type { OperationInput } from '@agentis-hq/core/operations'
import { identityRegistry, identityRegistryAbi, registrationCall } from './erc8004'
import { ens, ensClient, parentState, resolverAbi, canWriteText, textCall, recordKeys } from './contracts'

export function identityCall(input: OperationInput) {
  const terms = input.identity
  if (!terms || input.action !== 'identity_write' || input.chainId !== 'eip155:11155111' || input.asset !== 'native' || input.amountAtomic !== '0') throw Error('Invalid identity operation')
  if (terms.kind === 'register') return registrationCall(terms.value)
  if (terms.kind === 'document') {
    if (!terms.agentId) throw Error('Missing ERC-8004 ID')
    return { to: identityRegistry, value: 0n, data: encodeFunctionData({ abi: [{ type: 'function', name: 'setAgentURI', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }, { type: 'string' }], outputs: [] }], functionName: 'setAgentURI', args: [BigInt(terms.agentId), terms.value] }) }
  }
  if (!terms.key || terms.value.length > 2048) throw Error('Invalid delegated record')
  if (terms.key === 'endpoint' && terms.value && (!terms.value.startsWith('https://') || new URL(terms.value).username || new URL(terms.value).password)) throw Error('Endpoint must be HTTPS without credentials')
  return { to: getAddress(terms.resolver), value: 0n, data: textCall(terms.name, terms.key, terms.value) }
}
export async function validateIdentityChain(input: OperationInput, sender: Address) {
  identityCall(input)
  const terms = input.identity!, parent = terms.name.split('.').slice(1).join('.'), live = await parentState(parent)
  if (live.resolver.toLowerCase() !== terms.resolver.toLowerCase()) throw Error('ENS resolver changed; refresh identity setup')
  if (terms.kind === 'record' && !await canWriteText(terms.name, getAddress(terms.resolver), terms.key!, sender)) throw Error('ENS record permission is not delegated or has been revoked')
  if (terms.kind === 'document') {
    const owner = await ensClient().readContract({ address: identityRegistry, abi: identityRegistryAbi, functionName: 'ownerOf', args: [BigInt(terms.agentId!)] })
    if (owner.toLowerCase() !== sender.toLowerCase()) throw Error('ERC-8004 ownership changed')
  }
}
export function identityReceipt(input: OperationInput, receipt: TransactionReceipt) {
  if (receipt.status !== 'success') return undefined
  const terms = input.identity!
  if (terms.kind === 'register') {
    const matches = parseEventLogs({ abi: identityRegistryAbi, logs: receipt.logs, eventName: 'Registered' }).filter(log => log.address.toLowerCase() === identityRegistry.toLowerCase() && log.args.owner.toLowerCase() === receipt.from.toLowerCase() && log.args.agentURI === terms.value)
    if (matches.length !== 1) throw Error('Missing or ambiguous ERC-8004 registration event')
    return { agentId: matches[0]!.args.agentId.toString() }
  }
  if (terms.kind === 'record') {
    const matches = parseEventLogs({ abi: resolverAbi, logs: receipt.logs, eventName: 'TextChanged' }).filter(log => log.address.toLowerCase() === terms.resolver.toLowerCase() && log.args.node === namehash(terms.name) && log.args.key === recordKeys[terms.key!] && log.args.value === terms.value)
    if (matches.length !== 1) throw Error('Missing ENS record update event')
  } else {
    const matches = parseEventLogs({ abi: identityRegistryAbi, logs: receipt.logs, eventName: 'URIUpdated' }).filter(log => log.address.toLowerCase() === identityRegistry.toLowerCase() && log.args.agentId === BigInt(terms.agentId!) && log.args.newURI === terms.value)
    if (matches.length !== 1) throw Error('Missing ERC-8004 document update event')
  }
  return { ...(terms.agentId ? { agentId: terms.agentId } : {}), ...(terms.key ? { key: terms.key, value: terms.value } : {}) }
}
