import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { discovery: 'src/discovery.ts', tempo: 'src/tempo.ts', prices: 'src/prices.ts', networks: 'src/networks.ts', index: 'src/index.ts', operations: 'src/operations.ts', 'solana-transfer': 'src/solana-transfer.ts', 'payment-http': 'src/payment-http.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
})
