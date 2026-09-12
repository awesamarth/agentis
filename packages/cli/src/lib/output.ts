const chainNames: Record<string, string> = {
  'eip155:84532': 'Base',
  'eip155:5042002': 'Arc',
  'eip155:42431': 'Tempo',
  'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1': 'Solana',
}
export const namedChain = (id: string) => ({ name: chainNames[id] ?? id, id })
// External names, reasons and response data must not inject terminal controls.
const text = (value: unknown) => String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
const label = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase())
const chainLabel = (id: string) => `${text(namedChain(id).name)} (${text(id)})`

function fields(value: unknown, depth = 0): string {
  const pad = '  '.repeat(depth)
  if (value === null || value === undefined) return `${pad}—`
  if (typeof value !== 'object') return pad + text(typeof value === 'boolean' ? value ? 'yes' : 'no' : value)
  if (Array.isArray(value)) return value.length ? value.map(item => fields(item, depth)).join('\n\n') : `${pad}None`
  return Object.entries(value).filter(([, item]) => item !== null && item !== undefined).map(([key, item]) => {
    if (key === 'chainId' && typeof item === 'string') return `${pad}Chain: ${chainLabel(item)}`
    if (key === 'chainIds' && Array.isArray(item)) return `${pad}Chains: ${item.map(chainLabel).join(', ')}`
    if (key === 'bodyBase64' && typeof item === 'string') {
      const body = Buffer.from(item, 'base64')
      const headers = (value as { headers?: Record<string, string> }).headers
      const type = headers?.['content-type'] ?? ''
      if (body.length <= 4096 && type.includes('json')) {
        try { return `${pad}Response:\n${fields(JSON.parse(body.toString('utf8')), depth + 1)}` } catch { /* Show text below if the body is not valid JSON. */ }
      }
      if (body.length <= 4096 && (type.startsWith('text/') || type.includes('json'))) return `${pad}Response: ${text(body.toString('utf8'))}`
      return `${pad}Response body: ${body.length} bytes (use --json for the complete encoded response)`
    }
    if (typeof item === 'object') return `${pad}${text(label(key))}:\n${fields(item, depth + 1)}`
    return `${pad}${text(label(key))}: ${text(typeof item === 'boolean' ? item ? 'yes' : 'no' : item)}`
  }).join('\n')
}
export function formatOutput(command: string, output: unknown, color = Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined): string {
  if (output === null || output === undefined) return 'Done.'
  const record = output as Record<string, unknown>
  if (typeof record.message === 'string') return text(record.message)
  if (command === 'whoami' || command === 'login') {
    const agents = record.agents as { name: string; chains: { name: string; id: string }[] }[] | undefined
    if (!agents?.length) return 'Not logged in. Run agentis login.'
    const style = (value: string, codes: string) => color ? `\x1b[${codes}m${value}\x1b[0m` : value
    return agents.map(agent => `${style(text(agent.name), '1;38;5;117')}\n${style('Chains:', '1')}\n${agent.chains.map(chain => `${text(chain.name)} (${text(chain.id)})`).join(',\n')}`).join('\n\n')
  }
  if (command === 'history') {
    const transactions = record.transactions as { date: string | null; chain: string; amount: string; asset: string; status: string; to?: string; transaction?: string; httpStatus?: number; key?: string }[]
    if (!transactions.length) return `No local transactions for ${text(record.wallet)}.`
    return `${text(record.wallet)} — local history\n\n${transactions.map(tx => {
      const date = tx.date ? new Date(tx.date).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'Older entry'
      return `${date} · ${text(tx.chain)} · ${text(tx.amount)} ${text(tx.asset)} · ${text(tx.status.replaceAll('_', ' '))}${tx.httpStatus ? ` · HTTP ${tx.httpStatus}` : ''}\n${tx.transaction ? text(tx.transaction) : `To: ${text(tx.to ?? 'Not prepared')}`}${tx.key && tx.status === 'unknown' ? `\nCheck with original command and --key ${text(tx.key)}; do not resend.` : ''}`
    }).join('\n\n')}`
  }
  if (Array.isArray(output) && !output.length) return 'No results.'
  return fields(output)
}
