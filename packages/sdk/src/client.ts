import type { Operation, OperationInput, WalletPolicy, AuthorizationRequest, UsdLimits, GrantInput } from '@agentis-hq/core/operations'

export type AgentisAgent = { id: string; name: string; limits: UsdLimits; mode: 'ask' | 'automatic' | 'paused'; allowedRecipients: string[]; networks: string[]; defaultNetwork: string }
export type AgentSettings = Pick<AgentisAgent, 'name' | 'limits' | 'mode' | 'allowedRecipients'> & { selection: { networks: string[]; defaultNetwork: string }; enableExecution?: boolean }
export type AgentisWallet = { id: string; agentId: string | null; serverAuthorized: boolean; address: string; chainId: string; policy: WalletPolicy; policyVersion: number; enabled: boolean }

export type ProfileSummary = {
  totalAgents: number; activeAgents: number; totalSpendMicros: string; unpricedPayments: number
  daily: { date: string; spendMicros: string }[]
  byAgent: { id: string | null; name: string; spendMicros: string }[]
}
export type AccessKey = { id: string; walletId: string | null; agentId: string | null; chainIds: string[] | null; name: string; expiresAt: string | null; revokedAt: string | null }

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
  private async request<T>(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}, signal?: AbortSignal): Promise<T> {
    const token = typeof this.config.token === 'function' ? await this.config.token() : this.config.token
    const response = await (this.config.fetch ?? globalThis.fetch)(`${this.baseUrl}/v1${path}`, {
      method, redirect: 'error', signal: signal ?? AbortSignal.timeout(15_000),
      headers: { ...headers, 'content-type': 'application/json', authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (response.status === 204) return undefined as T
    const data = await response.json() as { error?: { code?: string; message?: string } }
    if (!response.ok) throw new AgentisApiError(response.status, data.error?.code ?? 'api_error', data.error?.message ?? 'Agentis request failed')
    return data as T
  }
  capabilities = () => this.request<Record<string, unknown>>('/capabilities')
  onboarding = {
    get: () => this.request<{ settings: { networks: string[]; defaultNetwork: string; totalBudgetUsd: string | null; completedAt: string } | null; networks: Array<{ key: string; name: string; chainId: string; chainType: string; currency: string; decimals: number; assets: Array<{ id: OperationInput['asset']; symbol: string; decimals: number }>; explorer: string; executionReady: boolean; testnet: boolean }> }>('/onboarding'),

  }
  agents = {
    list: () => this.request<AgentisAgent[]>('/agents'),
    create: (input: AgentSettings & { id: string }) => this.request<AgentisAgent>('/agents', 'POST', input),
    update: (id: string, input: AgentSettings) => this.request<AgentisAgent>(`/agents/${encodeURIComponent(id)}`, 'PATCH', input),
  }
  wallets = {
    list: () => this.request<AgentisWallet[]>('/wallets'),
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
    list: () => this.request<Operation[]>('/operations'),
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
