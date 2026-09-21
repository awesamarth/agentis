import { and, eq, sql } from 'drizzle-orm'
import { encodeFunctionData, getAddress, namehash, parseAbi, toHex, zeroAddress, type Address, type Hex } from 'viem'
import { base58 } from '@scure/base'
import { z } from 'zod'
import { agentIdentities, agents, wallets, operations, type WalletRow } from '../../db/schema'
import { fail } from '../../errors'
import { hash, type OperationService, type Principal } from '../../operations'
import type { OperationInput } from '@agentis-hq/core/operations'
import { ens, ensClient, normalizedName, parentState, registryAbi, factoryAbi, resolverAbi, labelId, allRoles, coinType, dnsName, recordKeys, canWriteText } from './contracts'
import { associationKey, registration, registrationUri } from './erc8004'
import { identityCall } from './execution'

type Identity = typeof agentIdentities.$inferSelect
export type IdentityStep = { complete: boolean; label: string; owner: string; transaction?: { to: string; data: string; value: string; chainId: '0xaa36a7' }; operation?: import('@agentis-hq/core/operations').Operation }
const setupSchema = z.object({ walletId: z.string().uuid(), parent: z.string().max(255), label: z.string().max(63), description: z.string().trim().max(500).default('') }).strict()
export class EnsService {
  constructor(private service: OperationService) {}
  get dashboardUrl() { return this.service.dashboardUrl }
  async wallet(principal: Principal, walletId: string) {
    await this.service.policyView(principal, walletId)
    const [wallet] = await this.service.db.select().from(wallets).where(and(eq(wallets.id, walletId), eq(wallets.ownerId, principal.ownerId)))
    if (!wallet?.agentId || !wallet.enabled) fail(403, 'wallet_unavailable', 'Choose an enabled agent wallet')
    return wallet
  }
  async row(principal: Principal, walletId: string) {
    const wallet = await this.wallet(principal, walletId)
    const [row] = await this.service.db.select().from(agentIdentities).where(and(eq(agentIdentities.agentId, wallet.agentId!), eq(agentIdentities.ownerId, principal.ownerId)))
    if (!row) fail(404, 'identity_missing', 'Set up this agent’s identity first')
    return { wallet, row }
  }
  async start(principal: Principal, raw: unknown) {
    if (principal.kind !== 'owner') fail(403, 'owner_required', 'Use the owner identity setup page')
    const input = setupSchema.parse(raw), wallet = await this.wallet(principal, input.walletId)
    if (wallet.chainId !== 'eip155:11155111') fail(400, 'identity_network', 'Enable Ethereum Sepolia in agent settings first')
    const [agent] = await this.service.db.select().from(agents).where(eq(agents.id, wallet.agentId!))
    if (!agent?.plugins.includes('ens')) fail(400, 'plugin_disabled', 'Enable ENS for this agent')
    const parent = await parentState(input.parent), name = normalizedName(`${input.label}.${parent.parent}`)
    if (name.split('.').length !== 3) fail(400, 'invalid_label', 'Choose a single subname label')
    await this.service.db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`owner:${principal.ownerId}`},0))`)
      const [old] = await tx.select().from(agentIdentities).where(eq(agentIdentities.agentId, wallet.agentId!))
      if (old) {
        if (old.name !== name || old.walletId !== wallet.id || old.parentOwner.toLowerCase() !== parent.owner.toLowerCase()) fail(409, 'identity_exists', 'This agent already has a different identity setup; do not overwrite it')
        return
      }
      await tx.insert(agentIdentities).values({ agentId: wallet.agentId!, ownerId: principal.ownerId, walletId: wallet.id, name, parent: parent.parent, parentOwner: parent.owner, resolver: parent.resolver, registry: parent.registry === zeroAddress ? null : parent.registry, salt: BigInt('0x' + hash(`agentis-ens:${principal.ownerId}:${parent.parent}`)).toString(), description: input.description }).onConflictDoNothing()
    })
    return this.next(principal, wallet.id)
  }
  private tx(label: string, owner: string, to: Address, data: Hex): IdentityStep { return { complete: false, label, owner, transaction: { to, data, value: '0x0', chainId: '0xaa36a7' } } }
  private async registered(row: Identity) {
    if (!row.registrationOperationId) return null
    const [op] = await this.service.db.select().from(operations).where(eq(operations.id, row.registrationOperationId))
    return op?.status === 'confirmed' && op.receipt?.identity?.agentId ? registration(op.receipt.identity.agentId) : null
  }
  async next(principal: Principal, walletId: string): Promise<IdentityStep> {
    if (principal.kind !== 'owner') fail(403, 'owner_required', 'Only the owner can prepare namespace transactions')
    const { row, wallet } = await this.row(principal, walletId), parent = await parentState(row.parent), client = ensClient()
    if (parent.owner.toLowerCase() !== row.parentOwner.toLowerCase() || parent.resolver.toLowerCase() !== row.resolver.toLowerCase()) fail(409, 'namespace_changed', 'Namespace ownership or resolver changed')
    const label = row.name.split('.')[0]!, owner = parent.owner, resolver = getAddress(row.resolver)
    let registry = row.registry ? getAddress(row.registry) : parent.registry
    if (registry === zeroAddress) {
      const data = encodeFunctionData({ abi: registryAbi, functionName: 'initialize', args: [owner, allRoles] })
      const simulated = await client.simulateContract({ address: ens.factory, abi: factoryAbi, functionName: 'deployProxy', args: [ens.registryImplementation, BigInt(row.salt), data], account: owner })
      registry = simulated.result
      await this.service.db.update(agentIdentities).set({ registry }).where(eq(agentIdentities.id, row.id))
      return this.tx('Create your ENSv2 subname registry', owner, ens.factory, encodeFunctionData({ abi: factoryAbi, functionName: 'deployProxy', args: [ens.registryImplementation, BigInt(row.salt), data] }))
    }
    if (!await client.getCode({ address: registry })) return this.tx('Create your ENSv2 subname registry', owner, ens.factory, encodeFunctionData({ abi: factoryAbi, functionName: 'deployProxy', args: [ens.registryImplementation, BigInt(row.salt), encodeFunctionData({ abi: registryAbi, functionName: 'initialize', args: [owner, allRoles] })] }))
    if ((await client.readContract({ address: ens.factory, abi: factoryAbi, functionName: 'verifyContract', args: [registry] })).toLowerCase() !== ens.registryImplementation) fail(409, 'invalid_registry', 'Expected an official ENSv2 UserRegistry')
    if (parent.registry === zeroAddress) {
      const back = await client.readContract({ address: registry, abi: parseAbi(['function getParent() view returns (address,string)']), functionName: 'getParent' })
      if (back[0].toLowerCase() !== ens.ethRegistry || back[1] !== parent.label) return this.tx('Link registry to your parent name', owner, registry, encodeFunctionData({ abi: registryAbi, functionName: 'setParent', args: [ens.ethRegistry, parent.label] }))
      return this.tx('Attach your subname registry', owner, ens.ethRegistry, encodeFunctionData({ abi: registryAbi, functionName: 'setSubregistry', args: [labelId(parent.label), registry] }))
    }
    if (parent.registry.toLowerCase() !== registry.toLowerCase()) fail(409, 'namespace_changed', 'Parent registry changed')
    const state = await client.readContract({ address: registry, abi: registryAbi, functionName: 'getState', args: [labelId(label)] })
    if (state.status === 0) return this.tx(`Register ${row.name}`, owner, registry, encodeFunctionData({ abi: registryAbi, functionName: 'register', args: [label, owner, zeroAddress, resolver, allRoles, parent.expiry] }))
    if (state.status !== 2 || state.latestOwner.toLowerCase() !== owner.toLowerCase()) fail(409, 'name_unavailable', 'Subname is not owned by the namespace owner')
    const node = namehash(row.name), readText = (key: string) => client.readContract({ address: resolver, abi: resolverAbi, functionName: 'text', args: [node, key] })
    const [agentRecord, ownerRecord] = await Promise.all([readText('org.agentis.id'), readText('org.agentis.owner')])
    if (agentRecord && agentRecord !== row.agentId) fail(409, 'name_in_use', 'Subname is already linked to another agent')
    if (agentRecord !== row.agentId || ownerRecord !== hash(row.ownerId)) {
      const ownedWallets = await this.service.db.select().from(wallets).where(and(eq(wallets.agentId, row.agentId), eq(wallets.ownerId, row.ownerId), eq(wallets.enabled, true)))
      const calls: Hex[] = ownedWallets.map(w => encodeFunctionData({ abi: resolverAbi, functionName: 'setAddr', args: [node, coinType(w.chainId), w.chainId.startsWith('solana:') ? toHex(base58.decode(w.address)) : getAddress(w.address)] }))
      for (const [key, value] of [['org.agentis.id', row.agentId], ['org.agentis.owner', hash(row.ownerId)], ['description', row.description]]) calls.push(encodeFunctionData({ abi: resolverAbi, functionName: 'setText', args: [node, key!, value!] }))
      for (const key of Object.values(recordKeys)) calls.push(encodeFunctionData({ abi: resolverAbi, functionName: 'authorizeTextRoles', args: [dnsName(row.name), key, getAddress(wallet.address), true] }))
      return this.tx('Publish wallet records and delegate only endpoint + description', owner, resolver, encodeFunctionData({ abi: resolverAbi, functionName: 'multicall', args: [calls] }))
    }
    if (!row.verified) await this.service.db.update(agentIdentities).set({ verified: true }).where(eq(agentIdentities.id, row.id))
    if (!row.registrationOperationId) {
      if (await client.getBalance({ address: getAddress(wallet.address) }) < 500000000000000n) return { complete: false, owner, label: 'Fund the agent with 0.001 Sepolia ETH for identity gas', transaction: { to: wallet.address, data: '0x', value: toHex(1000000000000000n), chainId: '0xaa36a7' } }
      const operation = await this.write(principal, wallet.id, 'register', undefined, undefined, `identity-register-${row.id}`)
      await this.service.db.update(agentIdentities).set({ registrationOperationId: operation.id }).where(eq(agentIdentities.id, row.id))
      return { complete: false, owner, label: 'Register ERC-8004 identity using the agent wallet', operation }
    }
    const registered = await this.registered(row)
    if (!registered) return { complete: false, owner, label: 'ERC-8004 registration', operation: await this.service.get(principal, row.registrationOperationId) }
    if (registered.owner.toLowerCase() !== wallet.address.toLowerCase() || registered.wallet.toLowerCase() !== wallet.address.toLowerCase()) fail(409, 'identity_changed', 'ERC-8004 ownership or payment wallet changed')
    const expectedUri = registrationUri(row.name, row.description, getAddress(wallet.address), registered.agentId)
    if (registered.uri !== expectedUri) return { complete: false, owner, label: 'Finalize the portable ERC-8004 registration document', operation: await this.write(principal, wallet.id, 'document', undefined, undefined, `identity-document-${row.id}-${registered.agentId}`) }
    const key = associationKey(registered.agentId)
    if (!await readText(key)) return this.tx('Associate ENS name with the ERC-8004 identity (ENSIP-25)', owner, resolver, encodeFunctionData({ abi: resolverAbi, functionName: 'setText', args: [node, key, '1'] }))
    return { complete: true, label: 'Identity configured', owner }
  }
  async write(principal: Principal, walletId: string, kind: 'record' | 'register' | 'document', key: 'endpoint' | 'description' | undefined, value: string | undefined, idempotencyKey: string) {
    const { row, wallet } = await this.row(principal, walletId)
    if (wallet.id !== row.walletId) fail(403, 'wrong_identity_wallet', 'Use this agent’s Ethereum Sepolia identity wallet')
    const registered = kind === 'document' ? await this.registered(row) : null
    const input: OperationInput = { walletId: wallet.id, action: 'identity_write', chainId: wallet.chainId, asset: 'native', to: wallet.address, amountAtomic: '0', maxFeeAtomic: kind === 'record' ? '500000000000000' : '1000000000000000', reason: kind === 'record' ? `Update ${key} on ${row.name}` : `ERC-8004 ${kind} for ${row.name}`, identity: { id: row.id, kind, name: row.name, resolver: row.resolver, ...(key ? { key } : {}), ...(registered ? { agentId: registered.agentId } : {}), value: kind === 'record' ? value ?? '' : registrationUri(row.name, row.description, getAddress(wallet.address), registered?.agentId) } }
    identityCall(input)
    return this.service.createPluginOperation(principal, input, idempotencyKey)
  }
  async retry(principal: Principal, walletId: string, operationId: string) {
    if (principal.kind !== 'owner') fail(403, 'owner_required', 'Only the owner can retry identity preparation')
    const { row, wallet } = await this.row(principal, walletId)
    const previous = await this.service.get(principal, operationId)
    const [stored] = await this.service.db.select().from(operations).where(eq(operations.id, operationId))
    if (!stored || previous.walletId !== wallet.id || previous.identity?.id !== row.id || previous.status !== 'failed' || stored.transactionHash || stored.signedTransaction || previous.error !== 'Preparation failed before submission') fail(409, 'cannot_retry', 'Only an identity preparation failure without submission can be retried')
    const operation = await this.write(principal, walletId, previous.identity.kind, previous.identity.key, previous.identity.value, `identity-retry-${operationId}`)
    if (previous.identity.kind === 'register') await this.service.db.update(agentIdentities).set({ registrationOperationId: operation.id }).where(and(eq(agentIdentities.id, row.id), eq(agentIdentities.registrationOperationId, operationId)))
    return { complete: false, owner: row.parentOwner, label: 'Review replacement identity operation', operation }
  }
  async delegation(principal: Principal, walletId: string, key: keyof typeof recordKeys, grant: boolean) {
    if (principal.kind !== 'owner') fail(403, 'owner_required', 'Delegation changes require the namespace owner')
    const { row, wallet } = await this.row(principal, walletId), parent = await parentState(row.parent)
    if (parent.owner.toLowerCase() !== row.parentOwner.toLowerCase() || parent.resolver.toLowerCase() !== row.resolver.toLowerCase()) fail(409, 'namespace_changed', 'Namespace ownership or resolver changed')
    return this.tx(`${grant ? 'Delegate' : 'Revoke'} ${key} only on ${row.name}`, parent.owner, getAddress(row.resolver), encodeFunctionData({ abi: resolverAbi, functionName: 'authorizeTextRoles', args: [dnsName(row.name), recordKeys[key], getAddress(wallet.address), grant] }))
  }
  async reason(tx: Parameters<Parameters<OperationService['db']['transaction']>[0]>[0], wallet: WalletRow, input: OperationInput) {
    if (!input.identity) return null
    const terms = input.identity
    const [row] = await tx.select().from(agentIdentities).where(eq(agentIdentities.id, terms.id))
    const [agent] = wallet.agentId ? await tx.select().from(agents).where(eq(agents.id, wallet.agentId)) : []
    if (!row?.verified || row.walletId !== wallet.id || row.ownerId !== wallet.ownerId || row.agentId !== wallet.agentId || wallet.chainId !== 'eip155:11155111') return 'Identity is not configured for this wallet'
    if (!agent?.plugins.includes('ens')) return 'ENS plugin is disabled'
    if (terms.name !== row.name || terms.resolver.toLowerCase() !== row.resolver.toLowerCase() || input.to.toLowerCase() !== wallet.address.toLowerCase()) return 'Identity terms changed'
    const parent = await parentState(row.parent)
    if (parent.owner.toLowerCase() !== row.parentOwner.toLowerCase() || parent.registry.toLowerCase() !== row.registry?.toLowerCase() || parent.resolver.toLowerCase() !== row.resolver.toLowerCase()) return 'ENS namespace changed'
    const client = ensClient(), node = namehash(row.name), resolver = getAddress(row.resolver)
    const [child, actualResolver, id, owner] = await Promise.all([
      client.readContract({ address: getAddress(row.registry!), abi: registryAbi, functionName: 'getState', args: [labelId(row.name.split('.')[0]!)] }),
      client.getEnsResolver({ name: row.name }),
      client.readContract({ address: resolver, abi: resolverAbi, functionName: 'text', args: [node, 'org.agentis.id'] }),
      client.readContract({ address: resolver, abi: resolverAbi, functionName: 'text', args: [node, 'org.agentis.owner'] }),
    ])
    if (child.status !== 2 || child.latestOwner.toLowerCase() !== parent.owner.toLowerCase() || actualResolver?.toLowerCase() !== row.resolver.toLowerCase() || id !== row.agentId || owner !== hash(row.ownerId)) return 'ENS identity ownership or binding changed'
    if (terms.kind === 'record') return terms.key && await canWriteText(row.name, resolver, terms.key, getAddress(wallet.address)) ? null : 'ENS record permission revoked or missing'
    if (terms.kind === 'register') return terms.value === registrationUri(row.name, row.description, getAddress(wallet.address)) ? null : 'Registration document changed'
    const registered = await this.registered(row)
    if (!registered || terms.agentId !== registered.agentId || registered.owner.toLowerCase() !== wallet.address.toLowerCase() || terms.value !== registrationUri(row.name, row.description, getAddress(wallet.address), registered.agentId)) return 'ERC-8004 registration changed'
    return null
  }
  async show(principal: Principal, walletId: string) {
    const { row } = await this.row(principal, walletId), client = ensClient(), resolver = getAddress(row.resolver), node = namehash(row.name)
    const [identityWallet] = await this.service.db.select().from(wallets).where(eq(wallets.id, row.walletId))
    const [endpoint, description, endpointAllowed, descriptionAllowed, registered] = await Promise.all([
      client.readContract({ address: resolver, abi: resolverAbi, functionName: 'text', args: [node, recordKeys.endpoint] }),
      client.readContract({ address: resolver, abi: resolverAbi, functionName: 'text', args: [node, recordKeys.description] }),
      canWriteText(row.name, resolver, 'endpoint', getAddress(identityWallet!.address)), canWriteText(row.name, resolver, 'description', getAddress(identityWallet!.address)), this.registered(row),
    ])
    const parent = await parentState(row.parent)
    const [currentResolver, binding, ownerBinding, child] = await Promise.all([
      client.getEnsResolver({ name: row.name }),
      client.readContract({ address: resolver, abi: resolverAbi, functionName: 'text', args: [node, 'org.agentis.id'] }),
      client.readContract({ address: resolver, abi: resolverAbi, functionName: 'text', args: [node, 'org.agentis.owner'] }),
      row.registry ? client.readContract({ address: getAddress(row.registry), abi: registryAbi, functionName: 'getState', args: [labelId(row.name.split('.')[0]!)] }) : null,
    ])
    const liveBinding = row.verified && child?.status === 2 && child.latestOwner.toLowerCase() === row.parentOwner.toLowerCase() && parent.owner.toLowerCase() === row.parentOwner.toLowerCase() && parent.registry.toLowerCase() === row.registry?.toLowerCase() && currentResolver?.toLowerCase() === row.resolver.toLowerCase() && binding === row.agentId && ownerBinding === hash(row.ownerId)
    const registrationMatches = registered && registered.owner.toLowerCase() === identityWallet!.address.toLowerCase() && registered.wallet.toLowerCase() === identityWallet!.address.toLowerCase() && registered.uri === registrationUri(row.name, row.description, getAddress(identityWallet!.address), registered.agentId)
    const association = registered ? await client.readContract({ address: resolver, abi: resolverAbi, functionName: 'text', args: [node, associationKey(registered.agentId)] }) : ''
    return { name: row.name, parent: row.parent, owner: row.parentOwner, resolver, walletId: row.walletId, wallet: identityWallet!.address, endpoint, description, delegation: { endpoint: endpointAllowed, description: descriptionAllowed }, registration: registered, associated: liveBinding && !!registrationMatches && !!association, verified: liveBinding }
  }
}
