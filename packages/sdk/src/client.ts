import type { Operation, OperationInput, WalletPolicy, AuthorizationRequest, UsdLimits, GrantInput, FetchRequest, PluginId } from '@agentis-hq/core/operations'

import type { SwapRequest, SwapQuote, SwapPlan, DcaInput, DcaSchedule, RebalancePreview } from './uniswap'

export type AgentisAgent = { id: string; name: string; plugins: PluginId[]; limits: UsdLimits; mode: 'ask' | 'automatic' | 'paused'; allowedRecipients: string[]; networks: string[]; defaultNetwork: string }
export type AgentSettings = Pick<AgentisAgent, 'name' | 'limits' | 'mode' | 'allowedRecipients'> & { plugins?: AgentisAgent['plugins']; selection: { networks: string[]; defaultNetwork: string }; enableExecution?: boolean }
export type AgentisWallet = { id: string; agentId: string | null; agentName: string | null; agentPlugins: AgentisAgent['plugins'] | null; serverAuthorized: boolean; address: string; chainId: string; policy: WalletPolicy; policyVersion: number; enabled: boolean }

export type AgentPolicyView = Pick<AgentisAgent, 'name' | 'mode' | 'limits' | 'allowedRecipients'> & { agentId: string; spentMicros: string; reservedMicros: string; walletPolicy: WalletPolicy }

export type AgentBalance = {
  usdMicros: string | null; complete: boolean; checkedAt: string
  networks: { chainId: string; name: string; usdMicros: string | null; complete: boolean; tokens: { asset: string; symbol: string; decimals: number; amountAtomic: string | null; usdMicros: string | null }[] }[]
}

export type ProfileSummary = {
  totalAgents: number; activeAgents: number; totalSpendMicros: string; unpricedPayments: number
  daily: { date: string; spendMicros: string }[]
  byAgent: { id: string | null; name: string; spendMicros: string }[]
}
export type AccessKey = { id: string; walletId: string | null; agentId: string | null; chainIds: string[] | null; name: string; expiresAt: string | null; revokedAt: string | null }

export type CliCredential = { id: string; agentId: string; agentName: string; chainIds: string[]; token: string }
export type CliLoginSelection = { agentId: string; chainIds: string[] }

export type AgentisConfig = {
  baseUrl: string
  /** Executor grant, or a fresh Privy owner access token. Never expose an owner token to an agent. */
  token: string | (() => string | Promise<string>)
  fetch?: typeof globalThis.fetch
}
export class AgentisApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}
export class AgentisClient {
  private baseUrl: string
  constructor(private config: AgentisConfig) {
    const url = new URL(config.baseUrl)
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('API URL must use HTTPS or loopback HTTP')
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
  }
  private async request<T>(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}, signal?: AbortSignal, authenticated = true): Promise<T> {
    const token = authenticated ? (typeof this.config.token === 'function' ? await this.config.token() : this.config.token) : null
    const response = await (this.config.fetch ?? globalThis.fetch)(`${this.baseUrl}/v1${path}`, {
      method, redirect: 'error', signal: signal ?? AbortSignal.timeout(15_000),
      headers: { ...headers, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (response.status === 204) return undefined as T
    const data = await response.json() as { error?: { code?: string; message?: string } }
    if (!response.ok) throw new AgentisApiError(response.status, data.error?.code ?? 'api_error', data.error?.message ?? 'Agentis request failed')
    return data as T
  }
  cliLogin = {
    start: (challenge: string) => this.request<{ id: string; approvalUrl: string; code: string; expiresAt: string }>('/cli/logins', 'POST', { challenge }, {}, undefined, false),
    exchange: (id: string, secret: string) => this.request<{ status: 'pending' } | { status: 'complete'; credentials: CliCredential[] }>(`/cli/logins/${encodeURIComponent(id)}/exchange`, 'POST', { secret }, {}, undefined, false),
    get: (id: string) => this.request<{ code: string; expiresAt: string; approved: boolean }>(`/cli/logins/${encodeURIComponent(id)}`),
    approve: (id: string, selections: CliLoginSelection[], code: string) => this.request<{ approved: true }>(`/cli/logins/${encodeURIComponent(id)}/approve`, 'POST', { selections, code, confirm: true }),
  }
  fetch = (input: FetchRequest, options: { idempotencyKey: string }) => this.request<Operation>('/fetch', 'POST', input, { 'Idempotency-Key': options.idempotencyKey }, AbortSignal.timeout(60_000))
  capabilities = () => this.request<Record<string, unknown>>('/capabilities')
  onboarding = {
    get: () => this.request<{ settings: { networks: string[]; defaultNetwork: string; totalBudgetUsd: string | null; completedAt: string } | null; networks: Array<{ key: string; name: string; chainId: string; chainType: string; currency: string; decimals: number; assets: Array<{ id: OperationInput['asset']; symbol: string; decimals: number }>; explorer: string; executionReady: boolean; testnet: boolean }> }>('/onboarding'),

  }
  oauth = {
    request: (id: string) => this.request<{ id: string; clientName: string; redirectUri: string; resource: string; expiresAt: string; completed: boolean }>(`/oauth/requests/${encodeURIComponent(id)}`),
    complete: (id: string, input: { approve: false } | { approve: true; confirm: true; selections: CliLoginSelection[] }) => this.request<{ redirectUrl: string }>(`/oauth/requests/${encodeURIComponent(id)}/complete`, 'POST', input),
  }
  agents = {
    list: () => this.request<AgentisAgent[]>('/agents'),
    balance: (id: string) => this.request<AgentBalance>(`/agents/${encodeURIComponent(id)}/balance`, 'GET', undefined, {}, AbortSignal.timeout(60_000)),
    setPlugins: (id: string, plugins: AgentisAgent['plugins']) => this.request<AgentisAgent>(`/agents/${encodeURIComponent(id)}/plugins`, 'PATCH', { plugins }),
    pause: (id: string) => this.request<AgentisAgent>(`/agents/${encodeURIComponent(id)}/pause`, 'POST'),
    create: (input: AgentSettings & { id: string }) => this.request<AgentisAgent>('/agents', 'POST', input),
    update: (id: string, input: AgentSettings) => this.request<AgentisAgent>(`/agents/${encodeURIComponent(id)}`, 'PATCH', input),
  }
  uniswap = {
    fetch: (input: FetchRequest, options: { idempotencyKey: string }) => this.request<{ funding: SwapPlan | null; payment: Operation | null }>('/plugins/uniswap/fetch', 'POST', input, { 'Idempotency-Key': options.idempotencyKey }, AbortSignal.timeout(60_000)),
    quote: (input: SwapRequest) => this.request<SwapQuote>('/plugins/uniswap/quote', 'POST', input, {}, AbortSignal.timeout(60_000)),
    swap: (input: SwapRequest, options: { idempotencyKey: string }) => this.request<SwapPlan>('/plugins/uniswap/swaps', 'POST', input, { 'Idempotency-Key': options.idempotencyKey }, AbortSignal.timeout(60_000)),
    get: (id: string) => this.request<SwapPlan>(`/plugins/uniswap/swaps/${encodeURIComponent(id)}`),
    target: (walletId: string) => this.request<{ ethPercent: number }>(`/plugins/uniswap/rebalance-target?walletId=${encodeURIComponent(walletId)}`),
    saveTarget: (walletId: string, ethPercent: number) => this.request<{ ethPercent: number }>('/plugins/uniswap/rebalance-target', 'POST', { walletId, ethPercent }),
    executeRebalance: (walletId: string, ethPercent: number, options: { idempotencyKey: string }) => this.request<SwapPlan | null>('/plugins/uniswap/rebalance/execute', 'POST', { walletId, ethPercent }, { 'Idempotency-Key': options.idempotencyKey }, AbortSignal.timeout(60_000)),
    rebalance: (walletId: string, ethPercent: number) => this.request<RebalancePreview>('/plugins/uniswap/rebalance', 'POST', { walletId, ethPercent }, {}, AbortSignal.timeout(60_000)),
    dca: {
      requestSetup: (input: { action: 'create' | 'edit' | 'active' | 'paused' | 'cancelled'; scheduleId?: string; input?: DcaInput }) => this.request<{ id: string; approvalUrl: string }>('/plugins/uniswap/dca-requests', 'POST', input),
      setup: (id: string) => this.request<{ id: string; walletId: string; action: string; input: DcaInput | null; currentSchedule: DcaSchedule | null; completed: boolean; expiresAt: string }>(`/plugins/uniswap/dca-requests/${encodeURIComponent(id)}`),
      completeSetup: (id: string, approve: boolean) => this.request<{ completed: boolean; approved: boolean }>(`/plugins/uniswap/dca-requests/${encodeURIComponent(id)}`, 'POST', { approve, confirm: true }),
      list: (walletId: string) => this.request<DcaSchedule[]>(`/plugins/uniswap/dca?walletId=${encodeURIComponent(walletId)}`),
      create: (input: DcaInput & { id: string }) => this.request<DcaSchedule>('/plugins/uniswap/dca', 'POST', input),
      update: (id: string, input: DcaInput) => this.request<DcaSchedule>(`/plugins/uniswap/dca/${encodeURIComponent(id)}`, 'PUT', input),
      status: (id: string, status: DcaSchedule['status']) => this.request<DcaSchedule>(`/plugins/uniswap/dca/${encodeURIComponent(id)}`, 'PATCH', { status, confirm: true }),
    },
  }
  history = () => this.request<Operation[]>('/history')
  wallets = {
    policy: (id: string) => this.request<AgentPolicyView>(`/wallets/${encodeURIComponent(id)}/policy`),
    list: () => this.request<AgentisWallet[]>('/wallets'),
    exportKey: (id: string, input: { confirm: true }) => this.request<{ privateKey: string }>(`/wallets/${encodeURIComponent(id)}/export`, 'POST', input, {}, AbortSignal.timeout(60_000)),
    link: (input: { providerWalletId: string; chainId: string; policy: WalletPolicy }) => this.request<AgentisWallet>('/wallets', 'POST', input),
    setPolicy: (id: string, policy: WalletPolicy) => this.request<Pick<AgentisWallet, 'id' | 'policy' | 'policyVersion'>>(`/wallets/${encodeURIComponent(id)}/policy`, 'PATCH', policy),
  }
  profile = { get: () => this.request<ProfileSummary>('/profile') }
  grants = {
    list: () => this.request<AccessKey[]>('/grants'),
    create: (input: GrantInput) => this.request<{ id: string; walletId: string | null; agentId: string | null; chainIds: string[] | null; token: string; expiresAt: string | null }>('/grants', 'POST', input),
    revoke: (id: string) => this.request<void>(`/grants/${encodeURIComponent(id)}`, 'DELETE'),
  }
  operations = {
    create: (input: OperationInput, options: { idempotencyKey: string }) => this.request<Operation>('/operations', 'POST', input, { 'Idempotency-Key': options.idempotencyKey }),
    list: (agentId?: string) => this.request<Operation[]>(`/operations${agentId ? `?agentId=${encodeURIComponent(agentId)}` : ''}`),
    get: (id: string, signal?: AbortSignal) => this.request<Operation>(`/operations/${encodeURIComponent(id)}`, 'GET', undefined, {}, signal),
    authorization: (id: string) => this.request<AuthorizationRequest>(`/operations/${encodeURIComponent(id)}/authorization`),
    approve: (id: string, operationHash: string, signature?: string) => this.request<Operation>(`/operations/${encodeURIComponent(id)}/approve`, 'POST', { operationHash, ...(signature ? { signature } : {}) }),
    reject: (id: string, operationHash: string) => this.request<Operation>(`/operations/${encodeURIComponent(id)}/reject`, 'POST', { operationHash }),
    wait: async (id: string, options: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal } = {}): Promise<Operation> => {
      const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs ?? 60_000)]) : AbortSignal.timeout(options.timeoutMs ?? 60_000)
      while (true) {
        signal.throwIfAborted()
        const operation = await this.operations.get(id, signal)
        // Approval and unknown execution are actionable results, not endless polling.
        if (!['queued', 'submitting', 'submitted'].includes(operation.status)) return operation
        await new Promise<void>((resolve, reject) => {
          const abort = () => { clearTimeout(timer); reject(signal.reason) }
          const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, Math.max(100, options.intervalMs ?? 1000))
          signal.addEventListener('abort', abort, { once: true })
          if (signal.aborted) abort()
        })
      }
    },
  }
}
