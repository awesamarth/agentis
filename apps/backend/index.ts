import { createRuntime } from './src/runtime'
const runtime = await createRuntime()
const server = Bun.serve({
  port: Number(process.env.PORT ?? 3001),
  hostname: runtime.local ? '127.0.0.1' : '0.0.0.0',
  fetch: runtime.app.fetch,
})
console.log(`Agentis API listening on port ${server.port}; executor=${runtime.service.executor?.id ?? 'disabled'}`)
async function shutdown() { await server.stop(true); await runtime.close(); process.exit(0) }
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
