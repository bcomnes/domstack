/** @import { AdditionalOutputProvenance } from './additional-outputs.js' */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeAdditionalOutputs, validateAdditionalOutputsHook } from './additional-outputs.js'

/** @type {AdditionalOutputProvenance} */
const provenance = { kind: 'page', source: '/src/page.ts' }
const record = { outputName: 'feed.json', content: '' }

test('additionalOutputs normalizes records, arrays, promises and async iterables', async () => {
  const expected = [{ ...record, provenance }]
  assert.deepEqual(await normalizeAdditionalOutputs(record, provenance), expected)
  assert.deepEqual(await normalizeAdditionalOutputs(Promise.resolve([record]), provenance), expected)
  async function * records () { yield record; yield { ...record, outputName: 'second.json' } }
  assert.deepEqual(await normalizeAdditionalOutputs(Promise.resolve(records()), provenance), [...expected, { ...record, outputName: 'second.json', provenance }])
  assert.deepEqual(await normalizeAdditionalOutputs([], provenance), [])
  async function * empty () {}
  assert.deepEqual(await normalizeAdditionalOutputs(empty(), provenance), [])
})

test('additionalOutputs rejects invalid hooks and records with source context', async () => {
  for (const hook of [null, true, {}, 'content']) {
    assert.throws(() => validateAdditionalOutputsHook(hook, provenance.source), /additionalOutputs.*\/src\/page.ts.*function/)
  }
  for (const result of ['bare string', undefined, null, {}, { outputName: '', content: '' }, { outputName: 'x', content: 1 }, [record, 'bad'], new Set([record])]) {
    await assert.rejects(normalizeAdditionalOutputs(result, provenance), /Invalid additionalOutputs.*\/src\/page.ts.*Record/)
  }
  async function * broken () { yield record; throw new Error('iterator failed') }
  await assert.rejects(normalizeAdditionalOutputs(broken(), provenance), /\/src\/page.ts.*iterator failed/)
  await assert.rejects(normalizeAdditionalOutputs(Promise.reject(new Error('promise failed')), provenance), /\/src\/page.ts.*promise failed/)
})
