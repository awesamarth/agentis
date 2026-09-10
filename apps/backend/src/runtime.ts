import { z } from 'zod'
import { timingSafeEqual } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { connectDatabase } from './db'
import { wallets } from './db/schema'
import { OperationService, hash } from './operations'
import { pluginConfig } from './plugins'
import { createAnvilExecutor } from './providers/anvil'
import { privyIdentity } from './providers/privy'
import { createApp } from './app'
import { privateKeyToAddress } from 'viem/accounts'
import type { Hex } from 'viem'
import { createPrivyExecutor } from './providers/privy-executor'
import type { Executor } from './providers/types'

export async function createRuntime(env = process.env) {
  const config = z.object({
    DATABASE_URL: z.string().url(),
    AGENTIS_EXECUTOR: z.enum(['disabled', 'anvil', 'privy']).default('disabled'),
    AGENTIS_PLUGINS: z.string().default('{}'),
    DASHBOARD_URL: z.string().url().default('http://localhost:3000'),
    PRIVY_APP_ID: z.string().optional(), PRIVY_APP_SECRET: z.string().optional(),
    PRIVY_AUTHORIZATION_PRIVATE_KEY: z.string().optional(), PRIVY_AUTHORIZATION_KEY_FILE: z.string().optional(),
    ANVIL_RPC_URL: z.string().url().default('http://127.0.0.1:8545'),
    ANVIL_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
    AGENTIS_LOCAL_OWNER_TOKEN: z.string().min(32).optional(),
  }).parse(env)
  if (config.AGENTIS_LOCAL_OWNER_TOKEN && (env.NODE_ENV === 'production' || config.AGENTIS_EXECUTOR !== 'anvil')) throw new Error('Local owner token is allowed only in local Anvil mode')
  const plugins = pluginConfig.parse(JSON.parse(config.AGENTIS_PLUGINS))
  const connection = connectDatabase(config.DATABASE_URL)
  let authorizationKey = config.PRIVY_AUTHORIZATION_PRIVATE_KEY
  if (!authorizationKey && config.PRIVY_AUTHORIZATION_KEY_FILE) {
    if (statSync(config.PRIVY_AUTHORIZATION_KEY_FILE).mode & 0o077) throw new Error('Privy authorization key file must be owner-only')
    authorizationKey = readFileSync(config.PRIVY_AUTHORIZATION_KEY_FILE, 'utf8').trim()
  }
  const privy = config.PRIVY_APP_ID && config.PRIVY_APP_SECRET ? privyIdentity(config.PRIVY_APP_ID, config.PRIVY_APP_SECRET, authorizationKey) : null
  let executor: Executor | null = null
  if (config.AGENTIS_EXECUTOR === 'privy') {
    if (!privy || !authorizationKey) throw new Error('Privy execution requires app credentials and a server authorization key')
    executor = createPrivyExecutor(config.PRIVY_APP_ID!, config.PRIVY_APP_SECRET!, privy.inspectWallet, authorizationKey)
  }
  if (config.AGENTIS_EXECUTOR === 'anvil') {
    if (!config.ANVIL_PRIVATE_KEY || !config.AGENTIS_LOCAL_OWNER_TOKEN) throw new Error('Local executor requires ANVIL_PRIVATE_KEY and AGENTIS_LOCAL_OWNER_TOKEN')
    executor = createAnvilExecutor(config.ANVIL_RPC_URL, config.ANVIL_PRIVATE_KEY as Hex)
    await connection.db.insert(wallets).values({
      ownerId: 'local-demo', provider: 'anvil', providerWalletId: 'local-demo',
      address: privateKeyToAddress(config.ANVIL_PRIVATE_KEY as Hex), chainId: 'eip155:31337',
      policy: { mode: 'ask', maxPerOperationAtomic: '100000000000000000', maxDailyAtomic: '1000000000000000000', maxLifetimeAtomic: '10000000000000000000', allowedRecipients: [] },
    }).onConflictDoNothing()
  }
  const identity = {
    async authenticate(token: string) {
      if (config.AGENTIS_LOCAL_OWNER_TOKEN && timingSafeEqual(Buffer.from(hash(token)), Buffer.from(hash(config.AGENTIS_LOCAL_OWNER_TOKEN)))) return 'local-demo'
      if (!privy) throw new Error('Owner authentication unavailable')
      return privy.authenticate(token)
    },
    inspectWallet: privy?.inspectWallet,
    createWallet: privy ? privy.createWallet.bind(privy) : undefined,
    enableServerExecution: privy ? privy.enableServerExecution.bind(privy) : undefined,
    exportWallet: privy ? privy.exportWallet.bind(privy) : undefined,
    createTestWallet: privy ? privy.createTestWallet.bind(privy) : undefined,
    exportTestWallet: privy ? privy.exportTestWallet.bind(privy) : undefined,
    testJwtRest: privy ? privy.testJwtRest.bind(privy) : undefined,
  }
  const service = new OperationService(connection.db, executor, plugins, config.DASHBOARD_URL.replace(/\/$/, ''))
  return { ...connection, service, app: createApp(service, identity, [new URL(config.DASHBOARD_URL).origin]), local: config.AGENTIS_EXECUTOR === 'anvil' }
}
