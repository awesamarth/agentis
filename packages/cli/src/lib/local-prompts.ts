import { text, multiselect, confirm, isCancel } from '@clack/prompts'
import { localNetworks, parseChains, type LocalChain } from './local-networks'

export function banner() {
  const art = `
 █████╗  ██████╗ ███████╗███╗   ██╗████████╗██╗███████╗
██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝██║██╔════╝
███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ██║███████╗
██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ██║╚════██║
██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ██║███████║
╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝╚══════╝
`
  console.log(process.env.NO_COLOR !== undefined ? art : `\x1b[38;5;117m\x1b[1m${art}\x1b[0m`)
}
function answer<T>(value: T | symbol): T {
  if (isCancel(value)) throw Error('Cancelled. No wallet created or payment sent.')
  return value as T
}
export async function localCreationOptions(name?: string, chains?: string, json = false): Promise<{ name: string; chains: LocalChain[] }> {
  const interactive = !json && process.stdin.isTTY && process.stdout.isTTY
  if (!name && !interactive) throw Error('--name is required without an interactive terminal')
  if (interactive && (!name || !chains)) banner()
  const walletName = name ?? answer(await text({ message: 'Wallet name', validate: value => !value?.trim() ? 'Enter a wallet name' : value.trim().length > 64 || /[\u0000-\u001f\u007f-\u009f]/.test(value) ? 'Use 1–64 characters without control characters' : undefined }))
  const selected = chains ? parseChains(chains) : interactive ? answer(await multiselect<LocalChain>({ message: 'Enable testnet chains (↑/↓ move, Space select, Enter continue)', options: Object.entries(localNetworks).map(([value, network]) => ({ value: value as LocalChain, label: network.name })), initialValues: ['base'], required: true })) : ['base'] as LocalChain[]
  // A plugins step can be added here when actual integrations are available.
  return { name: walletName, chains: selected }
}
export async function confirmLocalSend(summary: string, yes: boolean, json: boolean) {
  if (yes) return
  if (json || !process.stdin.isTTY || !process.stdout.isTTY) throw Error('Use --yes to authorize a non-interactive local send')
  if (!answer(await confirm({ message: summary, initialValue: false }))) throw Error('Cancelled. No payment sent.')
}
