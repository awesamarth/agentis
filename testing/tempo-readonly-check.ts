// Explicit live READ-ONLY probe. Run from apps/backend to load its private RPC
// config. No wallet credentials, database, signer, faucet, submission or worker.
import assert from 'node:assert/strict'
import { createPublicClient, http, erc20Abi, type Address } from 'viem'
import { Actions } from 'viem/tempo'
import { networks } from '../packages/core/src/networks'
import { readPrice } from '../packages/core/src/prices'
import { discoverMpp } from '../apps/backend/src/modules/mpp'

let failures = 0
for (const network of networks.filter(n => n.family === 'tempo')) {
  let stage = 'RPC identity'
  try {
    const client = createPublicClient({ chain: network.chain!, transport: http(process.env[network.rpcEnv] ?? network.rpcUrl, { retryCount: 0, timeout: 15_000 }) })
    assert.equal(await client.getChainId(), network.chain!.id)
    const block = await client.getBlock()
    assert(Math.abs(Date.now() / 1000 - Number(block.timestamp)) < 60)
    for (const asset of network.assets) {
      stage = `${asset.symbol} metadata`
      const address = asset.id.slice(6) as Address
      const metadata = await Actions.token.getMetadata(client, { token: address })
      assert.equal(metadata.symbol.toLowerCase(), asset.symbol.toLowerCase())
      if (asset.feeEligible !== false) {
        assert.equal(metadata.currency, 'USD')
        await Actions.fee.validateToken(client, { token: address })
      } else assert.notEqual(metadata.currency, 'USD')
      assert.equal(await client.readContract({ address, abi: erc20Abi, functionName: 'decimals' }), 6)
      console.log(`${network.key}: ${asset.symbol} exact contract and 6 decimals verified; fee eligible: ${asset.feeEligible !== false}`)
    }
  } catch { failures++; console.log(`${network.key}: ${stage} check FAILED (private RPC diagnostics withheld)`) }
}
for (const id of ['coingecko:open-usd', 'redstone:USDC', 'redstone:pathUSD']) {
  try { const quote = await readPrice(id); assert(quote.expiresAt > Date.now()); console.log(`${id}: fresh price verified (${quote.value} in 18-decimal USD units)`) }
  catch { failures++; console.log(`${id}: fresh price unavailable; spending must remain blocked`) }
}
// Unpaid GET only. Does NOT create an operation or send payment credentials.
for (const asset of ['USDC.e', 'pathUSD']) {
  try {
    const terms = await discoverMpp({ walletId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', url: 'https://agent402.tools/api/dns?name=example.com&type=A', asset, feeAsset: 'OUSD', maxAmountAtomic: '1000', maxFeeAtomic: '10000000000000000' })
    assert.equal(terms.chainId, 'eip155:4217')
    assert.equal(terms.amountAtomic, '1000')
    assert.notEqual(terms.asset, terms.feeAsset)
    console.log(`Live MPP offer: ${asset}, independent OUSD fee token, $0.001 nominal amount; discovery only`)
  } catch { failures++; console.log(`${asset}: live seller discovery unavailable or unsupported; no payment attempted`) }
}
if (failures) process.exitCode = 1
else console.log('All Tempo read-only checks passed. This does not prove signing, payment settlement or fee liquidity for a funded account.')
