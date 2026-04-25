import path from 'path'

const WORKER_PATH = path.join(import.meta.dir, 'prover-worker.mjs')
const NODE_BIN = process.env.NODE_BIN ?? 'node'

function serializeWorkerValue(value: unknown) {
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

function deserializeWorkerValue<T>(value: string): T {
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

// Spawns a Node.js child process to run ZK proof generation
// (ffjavascript's web-worker polyfill crashes in Bun but works in Node.js)
async function runNodeProver(type: string, inputs: unknown): Promise<unknown> {
  const payload = serializeWorkerValue({ type, inputs })

  const proc = Bun.spawn([NODE_BIN, WORKER_PATH], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  })

  proc.stdin.write(payload)
  proc.stdin.end()

  // Stream stderr to console in real time
  const stderrChunks: string[] = []
  const stderrDone = (async () => {
    const reader = proc.stderr.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const text = decoder.decode(value)
      stderrChunks.push(text)
      process.stdout.write(text) // pipe to backend console
    }
  })()

  const [stdout, , exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    stderrDone,
    proc.exited,
  ])
  const stderr = stderrChunks.join('')

  if (exitCode !== 0) {
    let errMsg = stderr
    try {
      errMsg = JSON.parse(stderr).error
    } catch {}
    throw new Error(`Node prover failed: ${errMsg}`)
  }

  return deserializeWorkerValue(stdout)
}

// IZkProverForUserRegistration-compatible prover that runs in Node.js
export function getNodeRegistrationProver() {
  return {
    prove: async (inputs: unknown) => {
      return runNodeProver('registration', inputs)
    },
  }
}

export function getNodeCreateReceiverClaimableUtxoFromPublicBalanceProver() {
  return {
    prove: async (inputs: unknown) => {
      return runNodeProver('create-receiver-claimable-utxo-from-public-balance', inputs)
    },
  }
}

export function getNodeClaimReceiverClaimableUtxoIntoEncryptedBalanceProver() {
  return {
    prove: async (inputs: unknown, nLeaves: number) => {
      return runNodeProver('claim-receiver-claimable-utxo-into-encrypted-balance', {
        inputs,
        nLeaves,
      })
    },
  }
}
