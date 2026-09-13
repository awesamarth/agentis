import { createRuntime } from './src/runtime'
const runtime = await createRuntime()
const server = Bun.serve({
  port: Number(process.env.PORT ?? 3001),
  hostname: runtime.local ? '127.0.0.1' : '0.0.0.0',
  fetch: runtime.app.fetch,
})
console.log(`Agentis API listening on port ${server.port}; executor=${runtime.service.executor?.id ?? 'disabled'}`)
let stopping = false
async function reconcile() {
  while (!stopping) {
    try { await runtime.service.tick() } catch { console.error('Reconciliation tick failed; will retry without resubmitting unknown operations') }
    if (!stopping) await Bun.sleep(1000)
  }
}
// Railway runs API and reconciliation together; local development can retain its separate worker.
const worker = process.env.AGENTIS_RUN_WORKER === 'true' ? reconcile() : Promise.resolve()
if (process.env.AGENTIS_RUN_WORKER === 'true') console.log('Payment reconciliation worker enabled')
async function shutdown() {
  if (stopping) return
  stopping = true
  await Promise.all([server.stop(true), worker])
  await runtime.close()
  process.exit(0)
}
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
