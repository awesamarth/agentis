// Diagnostics only: never log complete SDK errors, requests, responses or stacks.
export function safeErrorDetails(error: unknown) {
  const clean = (text: string) => text
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[url]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/(?:authorization|token|secret|password|api[-_]?key)\s*[:=]\s*\S+/gi, '[credential redacted]')
    .replace(/[A-Za-z0-9_+/=-]{24,}/g, '[redacted]')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .slice(0, 300)
  const causes: { name: string; message: string }[] = []
  const seen = new Set<Error>()
  let current = error
  while (current instanceof Error && !seen.has(current) && causes.length < 3) {
    seen.add(current)
    const short = (current as Error & { shortMessage?: unknown }).shortMessage
    causes.push({ name: clean(current.name), message: clean(typeof short === 'string' ? short : current.message.split('\n')[0]!) })
    current = current.cause
  }
  return causes.length ? causes : [{ name: 'UnknownError', message: 'Non-Error exception; payload omitted' }]
}
