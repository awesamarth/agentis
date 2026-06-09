const commandTree: Record<string, readonly string[] | null> = {
  login: null,
  logout: null,
  whoami: null,
  version: null,
  wallet: ['create', 'list'],
  agent: ['create', 'send', 'balance'],
  fetch: null,
  earn: ['deposit', 'withdraw', 'positions', 'sweep'],
  tokens: ['search'],
  swap: ['quote', 'execute'],
  portfolio: null,
  recurring: ['list', 'create', 'cancel'],
  facilitator: ['create', 'list', 'publish'],
  privacy: ['status', 'register', 'balance', 'deposit', 'withdraw', 'create-utxo', 'scan', 'claim-latest'],
  policy: ['get', 'set', 'init-onchain'],
}

export class CliCommandError extends Error {
  constructor(message: string, readonly helpCommand = 'agentis --help') {
    super(message)
    this.name = 'CliCommandError'
  }
}

function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let i = 1; i <= left.length; i++) {
    const current = [i]
    for (let j = 1; j <= right.length; j++) {
      current[j] = Math.min(
        current[j - 1]! + 1,
        previous[j]! + 1,
        previous[j - 1]! + (left[i - 1] === right[j - 1] ? 0 : 1),
      )
    }
    previous.splice(0, previous.length, ...current)
  }
  return previous[right.length]!
}

function closestMatch(value: string, choices: readonly string[]) {
  const ranked = choices
    .map(choice => ({ choice, distance: editDistance(value, choice) }))
    .sort((a, b) => a.distance - b.distance)
  const best = ranked[0]
  if (!best) return null
  const threshold = Math.max(1, Math.floor(Math.max(value.length, best.choice.length) / 3))
  return best.distance <= threshold ? best.choice : null
}

function unknownMessage(kind: 'command' | 'subcommand', value: string, suggestion: string | null, parent?: string) {
  const context = kind === 'subcommand' ? ` for "${parent}"` : ''
  return `Unknown ${kind} "${value}"${context}.${suggestion ? ` Did you mean "${suggestion}"?` : ''}`
}

export function validateCommand(args: string[]) {
  const command = args[0]
  if (!command || command === '--version' || command === '-v' || command === '--help' || command === '-h') return

  const subcommands = commandTree[command]
  if (subcommands === undefined) {
    throw new CliCommandError(
      unknownMessage('command', command, closestMatch(command, Object.keys(commandTree))),
    )
  }

  if (!subcommands) return
  const subcommand = args[1]
  const hasHelp = args.includes('--help') || args.includes('-h')
  if (!subcommand) {
    if (hasHelp) return
    throw new CliCommandError(`Missing command for "${command}".`, `agentis ${command} --help`)
  }
  if (subcommand.startsWith('-') && hasHelp) return
  if (!subcommands.includes(subcommand)) {
    throw new CliCommandError(
      unknownMessage('subcommand', subcommand, closestMatch(subcommand, subcommands), command),
      `agentis ${command} --help`,
    )
  }
}
