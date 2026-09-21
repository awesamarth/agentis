import type { Hono } from 'hono'
import { pluginIdValues, type OperationInput, type PluginId } from '@agentis-hq/core/operations'
import type { WalletRow } from '../db/schema'
import type { OperationService, Transaction } from '../operations'
import { EnsService } from './ens/service'
import { ensPublicRoutes, ensRoutes } from './ens/routes'
import { UniswapService } from './uniswap/service'
import { uniswapRoutes } from './uniswap/routes'

export type PluginCatalogEntry = {
  id: PluginId
  scope: 'agent'
  networks: string[]
  features: string[]
}

type PluginLifecycle = {
  reason?(tx: Transaction, wallet: WalletRow, input: OperationInput): Promise<string | null>
  disable?(tx: Transaction, agentId: string): Promise<void>
  tick?(): Promise<void>
}

type PluginDefinition = {
  catalog: PluginCatalogEntry
  create(service: OperationService): PluginLifecycle
  routes(service: PluginLifecycle): Hono<any>
  publicRoutes?(service: PluginLifecycle): { path: string; app: Hono<any> }
}

const definitions = {
  uniswap: {
    catalog: { id: 'uniswap', scope: 'agent', networks: ['eip155:84532'], features: ['swap', 'rebalance', 'dca', 'gas_refill', 'x402_shortfall_funding'] },
    create: (service: OperationService) => new UniswapService(service),
    routes: (service: PluginLifecycle) => uniswapRoutes(service as UniswapService),
  },
  ens: {
    catalog: { id: 'ens', scope: 'agent', networks: ['eip155:11155111'], features: ['subnames', 'payment_records', 'delegated_records', 'erc8004'] },
    create: (service: OperationService) => new EnsService(service),
    routes: (service: PluginLifecycle) => ensRoutes(service as EnsService),
    publicRoutes: (_service: PluginLifecycle) => ({ path: '/v1/ens', app: ensPublicRoutes() }),
  },
} as const satisfies Record<PluginId, PluginDefinition>

type ServiceMap = { [I in PluginId]: ReturnType<(typeof definitions)[I]['create']> }

export class PluginRegistry {
  readonly catalog = pluginIdValues.map(id => definitions[id].catalog)
  private readonly services: ServiceMap

  constructor(service: OperationService) {
    this.services = Object.fromEntries(pluginIdValues.map(id => [id, definitions[id].create(service)])) as ServiceMap
  }

  get<I extends PluginId>(id: I): ServiceMap[I] {
    return this.services[id]
  }

  authenticatedRoutes() {
    return pluginIdValues.map(id => ({ path: `/v1/plugins/${id}`, app: definitions[id].routes(this.services[id]) }))
  }

  publicRoutes() {
    return pluginIdValues.flatMap(id => {
      const definition = definitions[id]
      return 'publicRoutes' in definition ? [definition.publicRoutes(this.services[id])] : []
    })
  }

  async reason(tx: Transaction, wallet: WalletRow, input: OperationInput) {
    for (const id of pluginIdValues) {
      const reason = await (this.services[id] as PluginLifecycle).reason?.(tx, wallet, input)
      if (reason) return reason
    }
    return null
  }

  async disable(tx: Transaction, agentId: string, ids: readonly PluginId[]) {
    for (const id of ids) await (this.services[id] as PluginLifecycle).disable?.(tx, agentId)
  }

  async tick() {
    for (const id of pluginIdValues) await (this.services[id] as PluginLifecycle).tick?.()
  }
}
