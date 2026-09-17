/** @import { PageOutputProvenance } from './page-outputs.js' */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizePageOutputs, validatePageOutputsHook } from './page-outputs.js'

/** @type {PageOutputProvenance} */
const provenance = { kind: 'page', source: '/src/page.ts' }
const record = { outputName: 'feed.json', content: '' }

test('pageOutputs normalizes records, arrays, promises and async iterables', async () => {
  const expected = [{ ...record, provenance }]
  assert.deepEqual(await Array.fromAsync(normalizePageOutputs(record, provenance)), expected)
  assert.deepEqual(await Array.fromAsync(normalizePageOutputs(Promise.resolve([record]), provenance)), expected)
  async function * records () { yield record; yield { ...record, outputName: 'second.json' } }
  assert.deepEqual(await Array.fromAsync(normalizePageOutputs(Promise.resolve(records()), provenance)), [...expected, { ...record, outputName: 'second.json', provenance }])
  assert.deepEqual(await Array.fromAsync(normalizePageOutputs([], provenance)), [])
  async function * empty () {}
  assert.deepEqual(await Array.fromAsync(normalizePageOutputs(empty(), provenance)), [])
})

test('pageOutputs rejects invalid hooks and records with source context', async () => {
  for (const hook of [null, true, {}, 'content']) {
    assert.throws(() => validatePageOutputsHook(hook, provenance.source), /pageOutputs.*\/src\/page.ts.*function/)
  }
  for (const result of ['bare string', undefined, null, {}, { outputName: '', content: '' }, { outputName: 'x', content: 1 }, [record, 'bad'], new Set([record])]) {
    await assert.rejects(Array.fromAsync(normalizePageOutputs(result, provenance)), /Invalid pageOutputs.*\/src\/page.ts.*Record/)
  }

  await assert.rejects(Array.fromAsync(normalizePageOutputs(Promise.reject(new Error('promise failed')), provenance)), /\/src\/page.ts.*promise failed/)
})

test('normalization pulls one record at a time and closes the provider on return or break', async () => {
  for (const close of ['return', 'break']) {
    /** @type {string[]} */
    const events = []
    async function * records () {
      try {
        events.push('first')
        yield record
        events.push('second')
        yield { ...record, outputName: 'second.json' }
      } finally {
        events.push('closed')
      }
    }
    const outputs = normalizePageOutputs(records(), provenance)
    assert.equal(outputs[Symbol.asyncIterator](), outputs)
    assert.deepEqual(events, [])
    if (close === 'return') {
      const first = await outputs.next()
      assert.deepEqual(first, { value: { ...record, provenance }, done: false })
      assert.notEqual(first.value?.provenance, provenance)
      assert.deepEqual(events, ['first'])
      assert.deepEqual(await outputs.return(), { value: undefined, done: true })
    } else {
      // eslint-disable-next-line no-unreachable-loop -- Exercise iterator cleanup on an early break.
      for await (const output of outputs) {
        assert.deepEqual(output, { ...record, provenance })
        assert.deepEqual(events, ['first'])
        break
      }
    }
    assert.deepEqual(events, ['first', 'closed'])
    assert.deepEqual(await outputs.next(), { value: undefined, done: true })
  }
})

test('normalization validates each record only when requested with its record number', async () => {
  let closed = false
  async function * records () {
    try {
      yield record
      yield { outputName: 'invalid.json', content: 1 }
    } finally {
      closed = true
    }
  }
  for (const result of [[record, { outputName: 'invalid.json', content: 1 }], records()]) {
    const outputs = normalizePageOutputs(result, provenance)
    assert.deepEqual(await outputs.next(), { value: { ...record, provenance }, done: false })
    await assert.rejects(outputs.next(), error => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /Invalid pageOutputs from page "\/src\/page.ts": Record 2/)
      assert.ok(error.cause instanceof TypeError)
      return true
    })
  }
  assert.equal(closed, true)
})

test('normalization preserves iterator failure causes after yielding valid records', async () => {
  const cause = new Error('iterator failed')
  async function * records () {
    yield record
    throw cause
  }
  const outputs = normalizePageOutputs(records(), provenance)
  assert.deepEqual(await outputs.next(), { value: { ...record, provenance }, done: false })
  await assert.rejects(outputs.next(), error => {
    assert.ok(error instanceof Error)
    assert.match(error.message, /\/src\/page.ts.*iterator failed/)
    assert.equal(error.cause, cause)
    return true
  })
})
