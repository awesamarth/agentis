import { pgTable, uuid, text, timestamp, integer, jsonb, uniqueIndex, boolean, check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import type { Operation, OperationInput, OperationStatus, WalletPolicy, AuthorizationRequest, UsdQuote, UsdLimits } from '@agentis-hq/core/operations'

export const agents = pgTable('agents', {
  id: uuid().primaryKey(),
  ownerId: text().notNull(),
  name: text().notNull(),
  // USD micro-units; null explicitly means no cap.
  limits: jsonb().$type<UsdLimits>().notNull(),
  mode: text().$type<'ask' | 'automatic' | 'paused'>().notNull(),
  allowedRecipients: jsonb().$type<string[]>().notNull(),
  networks: jsonb().$type<string[]>().notNull(),
  defaultNetwork: text().notNull(),
})

export const wallets = pgTable('wallets', {
  id: uuid().primaryKey().defaultRandom(),
  ownerId: text().notNull(),
  agentId: uuid().references(() => agents.id),
  provider: text().notNull(),
  providerWalletId: text().notNull(),
  address: text().notNull(),
  chainId: text().notNull(),
  policy: jsonb().$type<WalletPolicy>().notNull(),
  policyVersion: integer().notNull().default(1),
  enabled: boolean().notNull().default(true),
  serverAuthorized: boolean().notNull().default(false),
}, table => [uniqueIndex('wallet_provider_chain').on(table.provider, table.providerWalletId, table.chainId)])

export const grants = pgTable('grants', {
  id: uuid().primaryKey().defaultRandom(),
  ownerId: text().notNull(),
  walletId: uuid().references(() => wallets.id),
  agentId: uuid().references(() => agents.id),
  chainIds: text().array(),
  agentName: text().notNull(),
  tokenHash: text().notNull().unique(),
  expiresAt: timestamp({ withTimezone: true, mode: 'date' }).notNull(),
  revokedAt: timestamp({ withTimezone: true, mode: 'date' }),
}, table => [
  check('grant_exactly_one_scope', sql`(${table.walletId} is null) <> (${table.agentId} is null)`),
  check('grant_network_scope', sql`${table.chainIds} is null or (${table.agentId} is not null and cardinality(${table.chainIds}) > 0 and array_position(${table.chainIds}, null) is null)`),
])

export const operations = pgTable('operations', {
  id: uuid().primaryKey().defaultRandom(),
  ownerId: text().notNull(),
  walletId: uuid().notNull().references(() => wallets.id),
  grantId: uuid().references(() => grants.id),
  principalKey: text().notNull(),
  idempotencyKey: text().notNull(),
  requestHash: text().notNull(),
  input: jsonb().$type<OperationInput>().notNull(),
  operationHash: text().notNull(),
  policyVersion: integer().notNull(),
  status: text().$type<OperationStatus>().notNull(),
  // Persist signed local transaction before broadcast; never expose it via API/logs.
  signedTransaction: text(),
  authorizationRequest: jsonb().$type<AuthorizationRequest>(),
  authorizationSignature: text(),
  transactionHash: text(),
  usdQuote: jsonb().$type<UsdQuote>(),
  usdReservedMicros: text(),
  usdSettledMicros: text(),
  receipt: jsonb().$type<Operation['receipt']>(),
  error: text(),
  approvedAt: timestamp({ withTimezone: true, mode: 'date' }),
  settledAt: timestamp({ withTimezone: true, mode: 'date' }),
  createdAt: timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  expiresAt: timestamp({ withTimezone: true, mode: 'date' }).notNull(),
}, table => [uniqueIndex('operation_idempotency').on(table.principalKey, table.idempotencyKey)])

export const onboarding = pgTable('onboarding', {
  ownerId: text().primaryKey(),
  totalBudgetUsdMicros: text(),
  networks: jsonb().$type<string[]>().notNull(),
  defaultNetwork: text().notNull(),
  completedAt: timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow(),
})

export type WalletRow = typeof wallets.$inferSelect
export type OperationRow = typeof operations.$inferSelect
