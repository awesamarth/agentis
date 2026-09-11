import type { OperationInput, Operation, AuthorizationRequest } from '@agentis-hq/core/operations'
import type { WalletRow } from '../db/schema'

// Shared execution boundary for Privy and local Anvil.
// Plugins cannot access these signing methods.
export interface Executor {
  readonly id: string
  validate(wallet: WalletRow, input: OperationInput): void
  authorization?(wallet: WalletRow, input: OperationInput, id: string, expiresAt: Date): Promise<AuthorizationRequest>
  prepare(wallet: WalletRow, input: OperationInput, authorization?: { request: AuthorizationRequest; signature: string }, execution?: { id: string; expiresAt: Date }): Promise<{ signedTransaction: string; transactionHash: string | null }>
  broadcast(signedTransaction: string): Promise<void | NonNullable<Operation['httpResponse']>>
  receipt(transactionHash: string | null, input?: OperationInput, signedTransaction?: string | null): Promise<Operation['receipt'] | { expiredUnused: true }>
}
