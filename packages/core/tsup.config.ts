import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts', operations: 'src/operations.ts', 'solana-transfer': 'src/solana-transfer.ts', 'payment-http': 'src/payment-http.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
})
