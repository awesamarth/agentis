import { select, text, isCancel } from '@clack/prompts'
import { AgentisClient } from '@agentis-hq/sdk'
import { sessions, apiUrl } from './session'

export const identityHelp = `Identity (ENSv2 + ERC-8004, Ethereum Sepolia):
  identity setup --agent <name> --parent <yourname.eth> [--label research]
  identity show --agent <name>
  identity resolve <name> --chain base|arc|tempo|solana|sepolia
  identity update --agent <name> --description <text> | --endpoint <https-url> --key <stable-key> --yes
  identity delegate|revoke --agent <name> --record endpoint|description
  Setup/delegation return an owner review link. Updates require on-chain delegation and normal agent approval/budgets.
  Hosted wallet send also accepts an ENS name in --to.`
export async function runIdentity(action: string | undefined, name: string | undefined, values: Record<string, string | boolean | undefined>) {
  if (values.help) { console.log(identityHelp); return }
  if (values.local && action !== 'resolve') throw Error('Identity administration currently uses hosted agents; ENS resolution is available through the backend')
  const str = (key: string) => typeof values[key] === 'string' ? values[key] as string : undefined
  const choices = action === 'resolve' ? [{ client: new AgentisClient({ baseUrl: apiUrl(), token: '' }), agentName: 'Public ENS resolution' }] : sessions(str('agent')), interactive = !!process.stdin.isTTY && !values.json
  let selected = choices[0]!
  if (choices.length !== 1) {
    if (!interactive) throw Error('Select --agent')
    const choice = await select({ message: 'Agent', options: choices.map((entry, i) => ({ value: i, label: entry.agentName })) })
    if (isCancel(choice)) throw Error('Cancelled')
    selected = choices[choice as number]!
  }
  const client = selected.client
  const print = (value: unknown, readable: string) => console.log(values.json ? JSON.stringify(value, null, 2) : readable)
  if (action === 'resolve') {
    if (!name) throw Error('Provide an ENS name')
    const networks: Record<string, string> = { base: 'eip155:84532', arc: 'eip155:5042002', tempo: 'eip155:42431', solana: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', sepolia: 'eip155:11155111' }
    const chain = networks[str('chain') ?? 'base']; if (!chain) throw Error('Choose a supported testnet --chain')
    const result = await client.identity.resolve(name, chain)
    print(result, `${result.name} → ${result.address}\nPayment network: ${result.chainId}\nENS resolution: Ethereum Sepolia`); return
  }
  const wallets = (await client.wallets.list()).filter(w => w.enabled && (!values.wallet || w.id === values.wallet) && (!values.agent || w.agentName === values.agent || w.agentId === values.agent))
  const wallet = wallets.find(w => w.chainId === 'eip155:11155111') ?? wallets[0]
  if (!wallet) throw Error('No authorized wallet for this agent')
  if (action === 'setup' || action === 'delegate' || action === 'revoke') {
    let parent = str('parent')
    if (action === 'setup' && !parent && interactive) { const answer = await text({ message: 'Your ENSv2 Sepolia parent name', placeholder: 'yourname.eth' }); if (isCancel(answer)) throw Error('Cancelled'); parent = answer as string }
    const result = await client.identity.requestSetup({ walletId: wallet.id, parent, label: str('label') })
    const url = new URL(result.approvalUrl)
    if (action !== 'setup') { const record = str('record'); if (record !== 'endpoint' && record !== 'description') throw Error('--record must be endpoint or description'); url.searchParams.set('action', action); url.searchParams.set('record', record) }
    print({ ...result, approvalUrl: url.toString() }, `${result.message}\nReview ${action}: ${url}`); return
  }
  if (action === 'show') {
    const result = await client.identity.show(wallet.id)
    print(result, `${result.name}\nOwner: ${result.owner}\nAgent wallet: ${result.wallet}\nERC-8004: ${result.registration ? `${result.registration.registry} #${result.registration.agentId}` : 'Not registered yet'}\nENS association: ${result.associated ? 'present' : 'pending'}\nDescription: ${result.description}\nEndpoint: ${result.endpoint}\nDelegated: ${Object.entries(result.delegation).filter(([, allowed]) => allowed).map(([key]) => key).join(', ') || 'none'}`); return
  }
  if (action === 'update') {
    if (wallet.chainId !== 'eip155:11155111') throw Error('Grant access to this agent’s Ethereum Sepolia wallet first')
    const endpoint = str('endpoint'), description = str('description'), key = str('key')
    if (Number(endpoint !== undefined) + Number(description !== undefined) !== 1) throw Error('Provide exactly one of --endpoint or --description')
    if (!key || !values.yes) throw Error('Use --key and --yes to request the update; Ask mode still requires owner approval')
    const operation = await client.identity.update({ walletId: wallet.id, key: endpoint !== undefined ? 'endpoint' : 'description', value: endpoint ?? description! }, { idempotencyKey: key })
    print(operation, `${operation.reason}\n${operation.status}${operation.approvalUrl ? `\nApprove: ${operation.approvalUrl}` : ''}\nOperation: ${operation.id}`); return
  }
  throw Error(identityHelp)
}
