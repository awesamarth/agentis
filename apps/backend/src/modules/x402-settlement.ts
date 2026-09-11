import { decodePaymentResponseHeader } from '@x402/core/http'
import { getBase58Encoder } from '@solana/kit'

export type SavePaymentHash = (hash: string) => Promise<void>

// The header supplies a lookup hint, not proof of settlement. Receipt verification
// must still bind the on-chain transaction to the persisted payment authorization.
export function settlementHeaders(network: string, payer: string, save?: SavePaymentHash) {
  return async (headers: Record<string, string>) => {
    const header = headers['payment-response'] ?? headers['x-payment-response']
    if (!header || !save) return
    let hash: string
    try {
      const result = decodePaymentResponseHeader(header)
      if (!result || result.network !== network || typeof result.transaction !== 'string') return
      const evm = network.startsWith('eip155:')
      if (result.payer !== undefined && (typeof result.payer !== 'string' || (evm ? result.payer.toLowerCase() !== payer.toLowerCase() : result.payer !== payer))) return
      hash = result.transaction
      if (evm ? !/^0x[0-9a-fA-F]{64}$/.test(hash) : !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(hash) || getBase58Encoder().encode(hash).length !== 64) return
    } catch { return } // Missing/malformed settlement metadata uses recovery lookup.
    await save(hash) // Never swallow a persistence failure.
  }
}
