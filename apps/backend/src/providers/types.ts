import type { OperationInput, Operation, AuthorizationRequest } from '@agentis-hq/core/operations'
import type { WalletRow } from '../db/schema'

// This boundary has two implementations in tests/runtime: deterministic fake and
// local Anvil. Plugins cannot access these signing methods.
export interface Executor {
  readonly id: string
  validate(wallet: WalletRow, input: OperationInput): void
  authorization?(wallet: WalletRow, input: OperationInput, id: string, expiresAt: Date): Promise<AuthorizationRequest>
  prepare(wallet: WalletRow, input: OperationInput, authorization?: { request: AuthorizationRequest; signature: string }, execution?: { id: string; expiresAt: Date }): Promise<{ signedTransaction: string; transactionHash: string }>
  broadcast(signedTransaction: string): Promise<void>
  receipt(transactionHash: string, input?: OperationInput): Promise<Operation['receipt']>
}
