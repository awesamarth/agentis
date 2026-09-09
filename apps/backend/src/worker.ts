import { createRuntime } from './runtime'
const runtime = await createRuntime()
let stopping = false
process.once('SIGTERM', () => { stopping = true })
process.once('SIGINT', () => { stopping = true })
try {
  while (!stopping) {
    try { await runtime.service.tick() } catch { console.error('Reconciliation tick failed; will retry without resubmitting unknown operations') }
    await Bun.sleep(1000)
  }
} finally { await runtime.close() }
