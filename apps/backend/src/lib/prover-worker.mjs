// Runs in Node.js (not Bun) — used for ZK proof generation
// ffjavascript's web-worker polyfill works correctly in Node.js

import { getUserRegistrationProver } from '@umbra-privacy/web-zk-prover'
import {
  getClaimReceiverClaimableUtxoIntoEncryptedBalanceProver,
  getCreateReceiverClaimableUtxoFromPublicBalanceProver,
} from '@umbra-privacy/web-zk-prover'
import { getCdnZkAssetProvider } from '@umbra-privacy/web-zk-prover/cdn'
import https from 'https'
import http from 'http'

function log(msg) {
  process.stderr.write(`[prover] ${msg}\n`)
}

function serializeWorkerValue(value) {
  return JSON.stringify(value, (_, currentValue) => {
    if (typeof currentValue === 'bigint') {
      return { __bigint: currentValue.toString() }
    }

    if (currentValue instanceof Uint8Array) {
      return { __uint8array: Array.from(currentValue) }
    }

    return currentValue
  })
}

function deserializeWorkerValue(value) {
  return JSON.parse(value, (_, currentValue) => {
    if (currentValue && typeof currentValue === 'object') {
      if ('__bigint' in currentValue) {
        return BigInt(currentValue.__bigint)
      }

      if ('__uint8array' in currentValue && Array.isArray(currentValue.__uint8array)) {
        return Uint8Array.from(currentValue.__uint8array)
      }
    }

    return currentValue
  })
}

// Asset provider with download progress logging
function getLoggingCdnProvider() {
  const cdn = getCdnZkAssetProvider()
  return {
    async getAssetUrls(type, variant) {
      return cdn.getAssetUrls(type, variant)
    },
  }
}

// Fetch with progress logging
const originalFetch = globalThis.fetch
globalThis.fetch = async function (url, opts) {
  log(`Fetching: ${url}`)
  const res = await originalFetch(url, opts)
  const contentLength = res.headers.get('content-length')
  if (!contentLength) return res

  const total = parseInt(contentLength, 10)
  let loaded = 0
  let lastPct = -1

  const reader = res.body.getReader()
  const chunks = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.length
    const pct = Math.floor((loaded / total) * 100)
    if (pct !== lastPct && pct % 10 === 0) {
      log(`Downloading ${url.split('/').pop()} — ${pct}% (${(loaded / 1024 / 1024).toFixed(1)}MB / ${(total / 1024 / 1024).toFixed(1)}MB)`)
      lastPct = pct
    }
  }

  const merged = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }

  log(`Downloaded ${url.split('/').pop()} — ${(total / 1024 / 1024).toFixed(1)}MB`)
  return new Response(merged, { status: res.status, headers: res.headers })
}

async function main() {
  let input = ''
  for await (const chunk of process.stdin) {
    input += chunk
  }

  const { type, inputs } = deserializeWorkerValue(input)

  log(`Starting proof generation for type: ${type}`)

  let result
  if (type === 'registration') {
    const prover = getUserRegistrationProver()
    log('Prover initialized, proving...')
    result = await prover.prove(inputs)
    log('Proof generated successfully')
  } else if (type === 'create-receiver-claimable-utxo-from-public-balance') {
    const prover = getCreateReceiverClaimableUtxoFromPublicBalanceProver()
    log('Prover initialized, proving...')
    result = await prover.prove(inputs)
    log('Proof generated successfully')
  } else if (type === 'claim-receiver-claimable-utxo-into-encrypted-balance') {
    const prover = getClaimReceiverClaimableUtxoIntoEncryptedBalanceProver()
    log('Prover initialized, proving...')
    result = await prover.prove(inputs.inputs, inputs.nLeaves)
    log('Proof generated successfully')
  } else {
    throw new Error(`Unknown prover type: ${type}`)
  }

  await new Promise((resolve, reject) => {
    process.stdout.write(serializeWorkerValue(result), (err) => {
      if (err) reject(err)
      else resolve()
    })
  })

  process.exit(0)
}

main().catch((err) => {
  log(`Error: ${err.message}`)
  process.stderr.write(JSON.stringify({ error: err.message }))
  process.exit(1)
})
