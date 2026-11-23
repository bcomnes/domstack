import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import test from 'node:test'
import { drainWrites } from './drain-writes.js'

test('draining writes reports a failure only after the other writer finishes', async () => {
  const write = Promise.withResolvers()
  const firstFailure = new Error('first failed write')
  let finished = false
  const result = drainWrites([write.promise, Promise.reject(firstFailure)])
  const checked = assert.rejects(result, error => error === firstFailure).then(() => { finished = true })
  try {
    await setImmediate()
    assert.equal(finished, false)
  } finally {
    write.resolve(undefined)
    await checked
  }
})

test('draining successful writes keeps results in order', async () => {
  assert.deepEqual(await drainWrites([Promise.resolve(42), Promise.resolve('written')]), [42, 'written'])
})
