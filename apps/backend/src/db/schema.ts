import { pgTable, uuid, text, timestamp, integer, jsonb, uniqueIndex, boolean, check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import type { Operation, OperationInput, OperationStatus, WalletPolicy, AuthorizationRequest, UsdQuote, UsdLimits, PluginId } from '@agentis-hq/core/operations'

export const agents = pgTable('agents', {
  id: uuid().primaryKey(),
  ownerId: text().notNull(),
  name: text().notNull(),
  plugins: jsonb().$type<PluginId[]>().notNull().default([]),
  // USD micro-units; null explicitly means no cap.
  limits: jsonb().$type<UsdLimits>().notNull(),
  mode: text().$type<'ask' | 'automatic' | 'paused'>().notNull(),
  allowedRecipients: jsonb().$type<string[]>().notNull(),
  networks: jsonb().$type<string[]>().notNull(),
  defaultNetwork: text().notNull(),
}, table => [check('agents_plugins_valid', sql`${table.plugins} IN ('[]'::jsonb, '["uniswap"]'::jsonb)`)])

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
  expiresAt: timestamp({ withTimezone: true, mode: 'date' }),
  revokedAt: timestamp({ withTimezone: true, mode: 'date' }),
}, table => [
  check('grant_exactly_one_scope', sql`(${table.walletId} is null) <> (${table.agentId} is null)`),
  check('grant_network_scope', sql`${table.chainIds} is null or (${table.agentId} is not null and cardinality(${table.chainIds}) > 0 and array_position(${table.chainIds}, null) is null)`),
])

export const oauthClients = pgTable('oauth_clients', {
  id: uuid().primaryKey().defaultRandom(), name: text().notNull(), redirectUris: jsonb('redirect_uris').$type<string[]>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
})
export const oauthConnections = pgTable('oauth_connections', {
  id: uuid().primaryKey().defaultRandom(), ownerId: text('owner_id').notNull(), clientId: uuid('client_id').notNull().references(() => oauthClients.id),
  resource: text().notNull(), grantIds: jsonb('grant_ids').$type<string[]>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(), revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
})
export const oauthRequests = pgTable('oauth_requests', {
  id: uuid().primaryKey().defaultRandom(), clientId: uuid('client_id').notNull().references(() => oauthClients.id),
  redirectUri: text('redirect_uri').notNull(), challenge: text().notNull(), state: text(), resource: text().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  codeHash: text('code_hash').unique(), connectionId: uuid('connection_id').references(() => oauthConnections.id), completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }), consumedAt: timestamp('consumed_at', { withTimezone: true, mode: 'date' }),
})
export const oauthTokens = pgTable('oauth_tokens', {
  id: uuid().primaryKey().defaultRandom(), connectionId: uuid('connection_id').notNull().references(() => oauthConnections.id),
  tokenHash: text('token_hash').notNull().unique(), kind: text().$type<'access' | 'refresh'>().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(), usedAt: timestamp('used_at', { withTimezone: true, mode: 'date' }),
})

export const cliLogins = pgTable('cli_logins', {
  id: uuid().primaryKey().defaultRandom(),
  challenge: text().notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  ownerId: text('owner_id'),
  selections: jsonb().$type<{ agentId: string; chainIds: string[] }[]>(),
  consumedAt: timestamp('consumed_at', { withTimezone: true, mode: 'date' }),
})

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
  httpResponse: jsonb('http_response').$type<Operation['httpResponse']>(),
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

export const uniswapTargets = pgTable('uniswap_targets', { walletId: uuid().primaryKey().references(() => wallets.id), ownerId: text().notNull(), ethPercent: integer().notNull() })
export const uniswapPlans = pgTable('uniswap_plans', {
  id: uuid().primaryKey().defaultRandom(), ownerId: text().notNull(), agentId: uuid().notNull().references(() => agents.id), walletId: uuid().notNull().references(() => wallets.id), grantId: uuid().references(() => grants.id),
  principalKey: text().notNull(), idempotencyKey: text().notNull(), requestHash: text().notNull(),
  request: jsonb().$type<import('../modules/uniswap').SwapRequest>().notNull(), quote: jsonb().$type<import('../modules/uniswap').SwapQuote>().notNull(),
  approvalId: uuid().references(() => operations.id), swapId: uuid().references(() => operations.id), paymentId: uuid().references(() => operations.id), fundingRequest: jsonb().$type<import('@agentis-hq/core/operations').FetchRequest>(),
  scheduleId: uuid(), scheduleVersion: integer(),
  status: text().$type<'pending' | 'complete' | 'failed' | 'cancelled'>().notNull().default('pending'), error: text(),
  createdAt: timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow(), expiresAt: timestamp({ withTimezone: true, mode: 'date' }).notNull(),
}, table => [uniqueIndex('uniswap_plan_key').on(table.principalKey, table.idempotencyKey)])
export const uniswapSchedules = pgTable('uniswap_schedules', {
  id: uuid().primaryKey().defaultRandom(), ownerId: text().notNull(), agentId: uuid().notNull().references(() => agents.id), walletId: uuid().notNull().references(() => wallets.id),
  request: jsonb().$type<import('../modules/uniswap').SwapRequest>().notNull(), intervalMinutes: integer().notNull(),
  kind: text().$type<'dca' | 'gas_refill'>().notNull().default('dca'), minimumGasAtomic: text(),
  status: text().$type<'active' | 'paused' | 'cancelled'>().notNull().default('active'), version: integer().notNull().default(1),
  nextRunAt: timestamp({ withTimezone: true, mode: 'date' }).notNull(), activePlanId: uuid().references(() => uniswapPlans.id),
  lastError: text(), createdAt: timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow(),
})

export const uniswapSetupRequests = pgTable('uniswap_setup_requests', {
  id: uuid().primaryKey().defaultRandom(), ownerId: text().notNull(), walletId: uuid().notNull().references(() => wallets.id), grantId: uuid().references(() => grants.id),
  action: text().$type<'create' | 'edit' | 'active' | 'paused' | 'cancelled'>().notNull(), scheduleId: uuid().references(() => uniswapSchedules.id), scheduleVersion: integer(), input: jsonb().$type<import('./../modules/uniswap-service').ScheduleInput>(),
  completed: boolean().notNull().default(false), expiresAt: timestamp({ withTimezone: true, mode: 'date' }).notNull(),
})
export type WalletRow = typeof wallets.$inferSelect
export type OperationRow = typeof operations.$inferSelect
