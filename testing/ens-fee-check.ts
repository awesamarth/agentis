// Pure fee sizing checks. No database, signing, network requests or funds.
import assert from 'node:assert/strict'
import { identityFeeCap } from '../apps/backend/src/plugins/ens/execution'

assert.equal(identityFeeCap(100n), 125n)
assert.equal(identityFeeCap(1n), 2n)
assert.equal(identityFeeCap(101n), 127n)
assert.equal(identityFeeCap(1314672814082704n), 1643341017603380n)
assert.equal(identityFeeCap(10n ** 30n), 125n * 10n ** 28n)
assert.throws(() => identityFeeCap(0n), /Invalid identity fee estimate/)
assert.throws(() => identityFeeCap(-1n), /Invalid identity fee estimate/)
console.log('ENS fee sizing passed: bigint, 25% headroom, ceiling rounding, invalid estimates rejected. No signing or funds.')
