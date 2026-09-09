import { z } from 'zod'

// Optional user-facing apps only. Transfers, networks, x402 and MPP are core.
// Unimplemented integrations cannot be silently enabled.
export const pluginConfig = z.object({
  jupiter: z.literal(false).default(false),
  umbra: z.literal(false).default(false),
  link: z.literal(false).default(false),
}).strict()
export type PluginConfig = z.infer<typeof pluginConfig>
