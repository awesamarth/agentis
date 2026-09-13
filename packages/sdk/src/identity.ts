import type { Operation } from '@agentis-hq/core/operations'
export type IdentityStep = { complete: boolean; label: string; owner: string; transaction?: { to: string; data: string; value: string; chainId: '0xaa36a7' }; operation?: Operation }
export type AgentIdentity = {
  name: string; parent: string; owner: string; resolver: string; walletId: string; wallet: string; endpoint: string; description: string;
  delegation: { endpoint: boolean; description: boolean }; verified: boolean; associated: boolean;
  registration: { registry: string; agentId: string; owner: string; wallet: string; uri: string } | null;
}
export type EnsRecipient = { name: string; chainId: string; address: string; resolver: string; resolutionChainId: string; checkedAt: string }
