import { getToken } from '../lib/keychain'
import { apiFetch } from '../lib/config'
import { DEFAULT_LOCAL_POLICY, loadLocalWalletByNameOrId, saveLocalWallet } from '../lib/local-wallet'
import { findAccountAgent } from '../lib/account'

async function findHostedAgent(nameOrId: string, token: string): Promise<any | null> {
  return findAccountAgent(nameOrId, token)
}

function printPolicy(name: string, p: any, scope: 'hosted' | 'local') {
  console.log(`\nPolicy for ${name} (${scope}):`)
  if (scope === 'hosted' && p.policyMode) {
    console.log(`  Mode:           ${p.policyMode}${p.onchainPolicy?.initialized ? ' (initialized)' : p.policyMode === 'onchain' ? ' (pending init)' : ''}`)
  }
  console.log(`  Kill switch:    ${p.killSwitch ? 'ON (agent halted)' : 'off'}`)
  console.log(`  Max per tx:     ${p.maxPerTx !== null ? `$${p.maxPerTx}` : 'unlimited'}`)
  console.log(`  Hourly limit:   ${p.hourlyLimit !== null ? `$${p.hourlyLimit}` : 'unlimited'}`)
  console.log(`  Daily limit:    ${p.dailyLimit !== null ? `$${p.dailyLimit}` : 'unlimited'}`)
  console.log(`  Monthly limit:  ${p.monthlyLimit !== null ? `$${p.monthlyLimit}` : 'unlimited'}`)
  console.log(`  Total budget:   ${p.maxBudget !== null ? `$${p.maxBudget}` : 'unlimited'}`)
  console.log(`  Allowed domains: ${p.allowedDomains?.length > 0 ? p.allowedDomains.join(', ') : 'all'}`)
  console.log()
}

function applyPolicyFlags(existingPolicy: any, args: string[]) {
  const policy: any = { ...DEFAULT_LOCAL_POLICY, ...(existingPolicy ?? {}) }
  const get = (flag: string) => {
    const idx = args.indexOf(flag)
    return idx !== -1 ? args[idx + 1] : undefined
  }

  if (args.includes('--kill')) policy.killSwitch = true
  if (args.includes('--resume')) policy.killSwitch = false
  if (get('--max-per-tx') !== undefined) policy.maxPerTx = parseFloat(get('--max-per-tx')!)
  if (get('--hourly') !== undefined) policy.hourlyLimit = parseFloat(get('--hourly')!)
  if (get('--daily') !== undefined) policy.dailyLimit = parseFloat(get('--daily')!)
  if (get('--monthly') !== undefined) policy.monthlyLimit = parseFloat(get('--monthly')!)
  if (get('--budget') !== undefined) policy.maxBudget = parseFloat(get('--budget')!)
  if (get('--allow')) {
    const domain = get('--allow')!.replace(/^https?:\/\//, '').toLowerCase()
    policy.allowedDomains = [...new Set([...(policy.allowedDomains ?? []), domain])]
  }
  if (get('--disallow')) {
    const domain = get('--disallow')!.replace(/^https?:\/\//, '').toLowerCase()
    policy.allowedDomains = (policy.allowedDomains ?? []).filter((d: string) => d !== domain)
  }

  return policy
}

export async function policyGet(nameOrId: string | undefined) {
  if (!nameOrId) {
    console.error('Usage: agentis policy get <name-or-id>')
    process.exit(1)
  }
  const token = await getToken()
  const hosted = token ? await findHostedAgent(nameOrId, token) : null
  if (hosted) {
    printPolicy(hosted.name, { ...DEFAULT_LOCAL_POLICY, ...(hosted.policy ?? {}), policyMode: hosted.policyMode ?? 'backend', onchainPolicy: hosted.onchainPolicy }, 'hosted')
    return
  }

  const local = loadLocalWalletByNameOrId(nameOrId)
  if (local) {
    printPolicy(local.name, local.policy, 'local')
    return
  }

  console.error(`Agent or local wallet not found: ${nameOrId}`)
  process.exit(1)
}

export async function policySet(nameOrId: string | undefined, args: string[]) {
  if (!nameOrId) {
    console.error('Usage: agentis policy set <name-or-id> [flags]')
    process.exit(1)
  }

  const token = await getToken()
  const hosted = token ? await findHostedAgent(nameOrId, token) : null

  if (hosted && token) {
    const policy = applyPolicyFlags(hosted.policy, args)
    const res = await apiFetch(`/agents/${hosted.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ policy }),
    }, token)

    if (!res.ok) {
      const data = await res.json()
      console.error('Failed to update policy:', data.error ?? res.statusText)
      process.exit(1)
    }

    console.log(`\nPolicy updated for ${hosted.name} (hosted).\n`)
    return
  }

  const local = loadLocalWalletByNameOrId(nameOrId)
  if (local) {
    local.policy = applyPolicyFlags(local.policy, args)
    saveLocalWallet(local)
    console.log(`\nPolicy updated for ${local.name} (local).\n`)
    return
  }

  console.error(`Agent or local wallet not found: ${nameOrId}`)
  process.exit(1)
}

export async function policyInitOnchain(nameOrId: string | undefined) {
  if (!nameOrId) {
    console.error('Usage: agentis policy init-onchain <name-or-id>')
    process.exit(1)
  }

  const token = await getToken()
  const hosted = token ? await findHostedAgent(nameOrId, token) : null
  if (!hosted || !token) {
    console.error(`Hosted agent not found: ${nameOrId}`)
    process.exit(1)
  }

  const res = await apiFetch(`/agents/${hosted.id}/policy/onchain/initialize`, {
    method: 'POST',
  }, token)
  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    console.error('Failed to initialize on-chain policy:', data.error ?? res.statusText)
    process.exit(1)
  }

  console.log(`\nOn-chain policy initialized for ${data.name}.`)
  console.log(`  Agent PDA:   ${data.onchainPolicy?.agent}`)
  console.log(`  Policy PDA:  ${data.onchainPolicy?.policy}`)
  console.log(`  Counter PDA: ${data.onchainPolicy?.spendCounter}`)
  console.log(`  Signature:   ${data.onchainPolicy?.initializedSignature}\n`)
}
