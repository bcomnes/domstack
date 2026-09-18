/**
 * @import { WatchDependencyState } from './watch-dependencies.js'
 * @typedef {{ name: string, value: null | string | boolean | number, json: string }} PrimitiveCase
 * @typedef {{ value: unknown, events: string[] }} DifferentialFixture
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, test } from 'node:test'
import { stableJsonStringify } from '../../helpers/stable-json-stringify.js'
import { WatchDependencyTracker } from './watch-dependencies.js'

/** @type {PrimitiveCase[]} */
const primitiveCases = [
  { name: 'null', value: null, json: 'null' },
  { name: 'true', value: true, json: 'true' },
  { name: 'false', value: false, json: 'false' },
  { name: 'empty string', value: '', json: '""' },
  { name: 'plain string', value: 'hello', json: '"hello"' },
  { name: 'null string', value: 'null', json: '"null"' },
  { name: 'boolean string', value: 'true', json: '"true"' },
  { name: 'numeric string', value: '0', json: '"0"' },
  { name: 'quotes and slashes', value: '"\\/', json: '"\\"\\\\/"' },
  { name: 'short control escapes', value: '\b\f\n\r\t', json: '"\\b\\f\\n\\r\\t"' },
  { name: 'other control escapes', value: '\u0000\u0001\u000b\u001f', json: '"\\u0000\\u0001\\u000b\\u001f"' },
  { name: 'literal escape text', value: '\\ud800\\n', json: '"\\\\ud800\\\\n"' },
  { name: 'lone high surrogate', value: '\ud800', json: '"\\ud800"' },
  { name: 'lone low surrogate', value: '\udfff', json: '"\\udfff"' },
  { name: 'unpaired surrogates in text', value: 'a\ud800b\udc00c', json: '"a\\ud800b\\udc00c"' },
  { name: 'surrogate pair', value: '\ud83d\ude00', json: '"😀"' },
  { name: 'unicode', value: 'café 日本語 😀', json: '"café 日本語 😀"' },
  { name: 'combining unicode', value: 'e\u0301', json: '"e\u0301"' },
  { name: 'precomposed unicode', value: 'é', json: '"é"' },
  { name: 'unicode separators', value: '\u2028\u2029', json: '"\u2028\u2029"' },
  { name: 'positive zero', value: 0, json: '0' },
  { name: 'one', value: 1, json: '1' },
  { name: 'negative integer', value: -42, json: '-42' },
  { name: 'fraction', value: 0.1, json: '0.1' },
  { name: 'rounded arithmetic', value: 0.1 + 0.2, json: '0.30000000000000004' },
  { name: 'epsilon', value: Number.EPSILON, json: '2.220446049250313e-16' },
  { name: 'adjacent to one', value: 1 + Number.EPSILON, json: '1.0000000000000002' },
  { name: 'minimum subnormal', value: Number.MIN_VALUE, json: '5e-324' },
  { name: 'negative minimum subnormal', value: -Number.MIN_VALUE, json: '-5e-324' },
  { name: 'next subnormal', value: Number.MIN_VALUE * 2, json: '1e-323' },
  { name: 'maximum subnormal', value: 2.225073858507201e-308, json: '2.225073858507201e-308' },
  { name: 'minimum normal', value: 2.2250738585072014e-308, json: '2.2250738585072014e-308' },
  { name: 'maximum finite', value: Number.MAX_VALUE, json: '1.7976931348623157e+308' },
  { name: 'negative maximum finite', value: -Number.MAX_VALUE, json: '-1.7976931348623157e+308' },
  { name: 'maximum safe integer', value: Number.MAX_SAFE_INTEGER, json: '9007199254740991' },
  { name: 'minimum safe integer', value: Number.MIN_SAFE_INTEGER, json: '-9007199254740991' },
  { name: 'unsafe finite integer', value: Number.MAX_SAFE_INTEGER + 1, json: '9007199254740992' },
  { name: 'decimal lower boundary', value: 1e-6, json: '0.000001' },
  { name: 'exponential below boundary', value: 1e-7, json: '1e-7' },
  { name: 'decimal upper boundary', value: 1e20, json: '100000000000000000000' },
  { name: 'exponential upper boundary', value: 1e21, json: '1e+21' },
  { name: 'negative exponential', value: -1e21, json: '-1e+21' },
]

/** @type {Record<string, unknown>} */
const opaquePrimitives = {
  negativeZero: -0,
  nan: NaN,
  infinity: Infinity,
  negativeInfinity: -Infinity,
  undefined,
  bigintZero: 0n,
  bigint: 9007199254740993n,
  symbol: Symbol('opaque'),
  globalSymbol: Symbol.for('domstack.fingerprint.test'),
  function: () => 'opaque',
}

/** @param {string} bytes */
function sha256 (bytes) {
  return createHash('sha256').update(bytes, 'utf8').digest('hex')
}

/** @param {unknown} value */
function legacyHash (value) {
  const bytes = stableJsonStringify(value)
  assert.equal(typeof bytes, 'string')
  assert.ok(bytes !== undefined)
  return sha256(bytes)
}

// Independent pre-optimization reference: do not share the optimized validator.
/**
 * @param {unknown} value
 * @param {Set<object>} ancestors
 * @returns {boolean}
 */
function legacyIsSafe (value, ancestors) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0)
  if (typeof value !== 'object' || ancestors.has(value)) return false
  if (Array.isArray(value)) {
    if (Reflect.ownKeys(value).length !== value.length + 1) return false
    ancestors.add(value)
    let safe = true
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index)
      if (!descriptor?.enumerable || !('value' in descriptor) || !legacyIsSafe(descriptor.value, ancestors)) {
        safe = false
        break
      }
    }
    ancestors.delete(value)
    return safe
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  ancestors.add(value)
  const safe = Reflect.ownKeys(value).every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (typeof key !== 'string' || !descriptor?.enumerable || !('value' in descriptor)) return false
    return legacyIsSafe(descriptor.value, ancestors)
  })
  ancestors.delete(value)
  return safe
}

/** @param {unknown} value */
function legacyFingerprint (value) {
  try {
    if (!legacyIsSafe(value, new Set())) return null
    const serialized = stableJsonStringify(value)
    return serialized === undefined ? null : sha256(serialized)
  } catch {
    return null
  }
}

/**
 * Factories keep mutation-heavy proxies and hooks independent between paths.
 * @param {() => DifferentialFixture} factory
 * @param {string} label
 */
function assertLegacyEquivalent (factory, label) {
  const legacy = factory()
  const optimized = factory()
  const tracker = new WatchDependencyTracker(null, { fullBuild: true })
  let previous = null
  for (let build = 0; build < 2; build++) {
    const expected = legacyFingerprint(legacy.value)
    const changed = tracker.updateGlobalDataFingerprints({ value: optimized.value }, { value: previous })
    assert.deepEqual(optimized.events, legacy.events, `${label}: build ${build} observation order/count`)
    assert.equal(tracker.state.globalDataFingerprints['value'], expected, `${label}: build ${build} hash`)
    assert.deepEqual([...changed], previous === null || expected === null || previous !== expected ? ['value'] : [], `${label}: build ${build} invalidation`)
    previous = expected
  }
}

/** @param {number} seed */
function seededGraph (seed) {
  let state = seed >>> 0
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state
  }
  /** @type {object[]} */
  const completed = []
  const keys = ['2', '10', '01', '4294967294', '4294967295', '__proto__', 'constructor', 'é', 'e\u0301', 'Å', 'A\u030a', '\ud800', '\u0000', '😀']
  /** @returns {unknown} */
  function build (/** @type {number} */ depth) {
    if (depth === 0 || random() % 5 === 0) return primitiveCases[random() % primitiveCases.length]?.value ?? null
    if (completed.length && random() % 5 === 0) return completed[random() % completed.length]
    const length = random() % 4 + 1
    /** @type {unknown[] | Record<string, unknown>} */
    const result = random() % 2 === 0 ? [] : Object.create(random() % 2 === 0 ? null : Object.prototype)
    for (let index = 0; index < length; index++) {
      const value = build(depth - 1)
      if (Array.isArray(result)) result.push(value)
      else Object.defineProperty(result, keys[random() % keys.length] ?? 'key', { value, enumerable: true, configurable: true })
    }
    completed.push(result)
    return result
  }
  const graph = build(5)
  return { graph, aliases: [graph, graph], seed }
}

// These synchronous tests share JSON spies and temporary prototype hooks.
// Keep them serial even when the test runner enables concurrency elsewhere.
describe('global-data fingerprint compatibility', { concurrency: false }, () => {
  test('hashes exact legacy JSON bytes for supported top-level primitives', () => {
    const tracker = new WatchDependencyTracker(null, { fullBuild: true })
    for (const { name, value, json } of primitiveCases) {
      assert.equal(stableJsonStringify(value), json, `${name}: legacy bytes`)
      const expected = sha256(json)
      assert.deepEqual([...tracker.updateGlobalDataFingerprints({ value }, null)], ['value'], name)
      assert.equal(tracker.state.globalDataFingerprints['value'], expected, name)
      assert.deepEqual([...tracker.updateGlobalDataFingerprints({ value }, { value: expected })], [], name)
    }
  })

  test('keeps primitive types, escape text, and Unicode normalization forms distinct', () => {
    const values = [null, 'null', true, 'true', false, 'false', 0, '0', 1, '1', '', '\n', '\\n', '\ud800', '\\ud800', 'é', 'e\u0301']
    const tracker = new WatchDependencyTracker(null, { fullBuild: true })
    tracker.updateGlobalDataFingerprints(Object.fromEntries(values.map((value, index) => [index, value])), null)
    const hashes = Object.values(tracker.state.globalDataFingerprints)
    assert.equal(hashes.includes(null), false)
    assert.equal(new Set(hashes).size, values.length)

    for (const [index, value] of values.entries()) {
      const other = values[(index + 1) % values.length]
      assert.deepEqual([...tracker.updateGlobalDataFingerprints({ value: other }, { value: legacyHash(value) })], ['value'])
    }
  })

  test('compares incremental builds against a legacy fingerprint snapshot', () => {
    const unchanged = Object.fromEntries(primitiveCases.map(({ name, value }) => [name, value]))
    /** @type {WatchDependencyState} */
    const previousState = {
      consumers: {},
      globalDataFingerprints: {
        removed: legacyHash('gone'),
        changed: legacyHash('before'),
        typeChanged: legacyHash(1),
        becameOpaque: legacyHash(0),
        becameSupported: null,
        ...Object.fromEntries(Object.entries(unchanged).map(([key, value]) => [key, legacyHash(value)])),
        ...Object.fromEntries(Object.keys(opaquePrimitives).map(key => [key, null])),
      },
    }
    const before = structuredClone(previousState)
    const data = {
      ...unchanged,
      ...opaquePrimitives,
      changed: 'after',
      typeChanged: '1',
      becameOpaque: -0,
      becameSupported: 0,
      added: false,
    }
    const next = new WatchDependencyTracker(previousState, { fullBuild: false })
    assert.deepEqual([...next.updateGlobalDataFingerprints(data, previousState.globalDataFingerprints)], [
      'removed', 'changed', 'typeChanged', 'becameOpaque', 'becameSupported', ...Object.keys(opaquePrimitives), 'added',
    ])
    assert.deepEqual(previousState, before, 'legacy snapshot remains unchanged')

    const repeated = new WatchDependencyTracker(next.state, { fullBuild: false })
    assert.deepEqual([...repeated.updateGlobalDataFingerprints(data, next.state.globalDataFingerprints)], [
      ...Object.keys(opaquePrimitives), 'becameOpaque',
    ])
    assert.deepEqual(repeated.state.globalDataFingerprints, next.state.globalDataFingerprints)
  })

  test('keeps unsupported primitives opaque on every build, including inside objects and arrays', () => {
    for (const [name, value] of Object.entries(opaquePrimitives)) {
      const data = { primitive: value, object: { nested: value }, array: [value] }
      let tracker = new WatchDependencyTracker(null, { fullBuild: true })
      for (let build = 0; build < 3; build++) {
        const previous = tracker.state
        tracker = new WatchDependencyTracker(previous, { fullBuild: false })
        assert.deepEqual([...tracker.updateGlobalDataFingerprints(data, previous.globalDataFingerprints)], Object.keys(data), name)
        assert.deepEqual(Object.values(tracker.state.globalDataFingerprints), [null, null, null], name)
      }
    }
  })

  test('supported top-level primitives skip JSON.parse and stringify only once each', t => {
    const data = Object.fromEntries(primitiveCases.map(({ name, value }) => [name, value]))
    const expected = Object.fromEntries(primitiveCases.map(({ name, json }) => [name, sha256(json)]))
    const tracker = new WatchDependencyTracker(null, { fullBuild: true })
    const parse = t.mock.method(JSON, 'parse')
    const stringify = t.mock.method(JSON, 'stringify')
    let parseCalls
    let stringifyCalls
    try {
      tracker.updateGlobalDataFingerprints(data, expected)
      parseCalls = parse.mock.callCount()
      stringifyCalls = stringify.mock.callCount()
    } finally {
      stringify.mock.restore()
      parse.mock.restore()
    }
    assert.deepEqual({ ...tracker.state.globalDataFingerprints }, expected)
    assert.equal(parseCalls, 0, 'the primitive fast path must not JSON.parse')
    assert.equal(stringifyCalls, primitiveCases.length, 'hash the first JSON.stringify result directly')
  })

  test('ordinary objects and arrays skip JSON.parse and whole-graph JSON.stringify', t => {
    const data = {
      object: { b: [1, 'text'], a: null },
      array: [true, { z: 2, a: 1 }],
      emptyObject: {},
      emptyArray: [],
      nullObject: Object.assign(Object.create(null), { a: 1 }),
      nullArray: Object.setPrototypeOf([1, 2], null),
      ...Object.fromEntries(Array.from({ length: 80 }, (_, seed) => [`seed-${seed}`, seededGraph(seed)])),
    }
    const expected = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, legacyFingerprint(value)]))
    assert.ok(Object.values(expected).every(hash => typeof hash === 'string'))
    const tracker = new WatchDependencyTracker(null, { fullBuild: true })
    const parse = t.mock.method(JSON, 'parse')
    const stringify = t.mock.method(JSON, 'stringify')
    let parseCalls
    let serializedObjects
    try {
      tracker.updateGlobalDataFingerprints(data, expected)
      parseCalls = parse.mock.callCount()
      serializedObjects = stringify.mock.calls.filter(({ arguments: [value] }) => value !== null && typeof value === 'object').length
    } finally {
      stringify.mock.restore()
      parse.mock.restore()
    }
    assert.equal(parseCalls, 0)
    assert.equal(serializedObjects, 0, 'serialize leaves, not the original graph')
    assert.deepEqual({ ...tracker.state.globalDataFingerprints }, expected)
    assert.deepEqual([...tracker.updateGlobalDataFingerprints(data, expected)], [])
  })

  test('the shared stableJsonStringify helper retains its primitive JSON round-trip', t => {
    const parse = t.mock.method(JSON, 'parse')
    const stringify = t.mock.method(JSON, 'stringify')
    let bytes
    let parseCalls
    let stringifyCalls
    try {
      bytes = stableJsonStringify('shared helper')
      parseCalls = parse.mock.callCount()
      stringifyCalls = stringify.mock.callCount()
    } finally {
      stringify.mock.restore()
      parse.mock.restore()
    }
    assert.equal(bytes, '"shared helper"')
    assert.equal(parseCalls, 1)
    assert.equal(stringifyCalls, 2)
  })

  test('accepts nested aliases by value but keeps object and array cycles opaque', () => {
    const shared = { z: [1, null], a: 'shared' }
    const aliases = { left: shared, right: [shared, { again: shared }] }
    const independent = { right: [{ a: 'shared', z: [1, null] }, { again: { a: 'shared', z: [1, null] } }], left: { a: 'shared', z: [1, null] } }
    const cycle = {}; Object.assign(cycle, { child: { back: cycle } })
    /** @type {unknown[]} */
    const arrayCycle = []
    arrayCycle.push({ back: arrayCycle })
    const tracker = new WatchDependencyTracker(null, { fullBuild: true })
    const data = { aliases, cycle, arrayCycle }
    tracker.updateGlobalDataFingerprints(data, null)
    assert.equal(tracker.state.globalDataFingerprints['aliases'], legacyHash(aliases))
    assert.equal(legacyHash(aliases), legacyHash(independent))
    assert.equal(tracker.state.globalDataFingerprints['cycle'], null)
    assert.equal(tracker.state.globalDataFingerprints['arrayCycle'], null)
    assert.deepEqual([...tracker.updateGlobalDataFingerprints({ ...data, aliases: independent }, tracker.state.globalDataFingerprints)], ['cycle', 'arrayCycle'])
  })

  test('preserves special names in null-prototype objects and top-level fingerprint keys', () => {
    const value = Object.assign(Object.create(null), {
      ['__proto__']: { polluted: 'data only' }, constructor: 'constructor', prototype: 'prototype', toString: 'toString',
    })
    const expected = legacyHash(value)
    const tracker = new WatchDependencyTracker(null, { fullBuild: true })
    const data = { ['__proto__']: value, constructor: value, toString: value }
    tracker.updateGlobalDataFingerprints(data, null)
    assert.equal(Object.getPrototypeOf(tracker.state.globalDataFingerprints), null)
    assert.deepEqual(Object.keys(tracker.state.globalDataFingerprints), Object.keys(data))
    assert.deepEqual(Object.values(tracker.state.globalDataFingerprints), [expected, expected, expected])
    assert.deepEqual([...tracker.updateGlobalDataFingerprints(data, tracker.state.globalDataFingerprints)], [])
    assert.equal(Object.getPrototypeOf(value), null)
    assert.equal(Object.hasOwn(Object.prototype, 'polluted'), false)
  })

  test('retains localeCompare key ordering rather than insertion or numeric ordering', () => {
    const keys = ['z', 'é', 'E', 'ä', 'a', 'Z', '10', '2', '__proto__']
    const value = Object.fromEntries(keys.map(key => [key, key]))
    // Derive ordering from this host's locale, just like the legacy helper.
    const bytes = `{${[...keys].sort((a, b) => a.localeCompare(b)).map(key => `${JSON.stringify(key)}:${JSON.stringify(key)}`).join(',')}}`
    assert.equal(stableJsonStringify(value), bytes)
    assert.notEqual(bytes, JSON.stringify(value))
    const tracker = new WatchDependencyTracker(null, { fullBuild: true })
    tracker.updateGlobalDataFingerprints({ value }, null)
    assert.equal(tracker.state.globalDataFingerprints['value'], sha256(bytes))
    const reversed = Object.fromEntries([...keys].reverse().map(key => [key, key]))
    assert.deepEqual([...tracker.updateGlobalDataFingerprints({ value: reversed }, tracker.state.globalDataFingerprints)], [])
  })

  test('retains inherited Array.prototype.toJSON behavior and conservative serialization failures', () => {
    const previous = Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON')
    const value = [1, 2]
    /** @type {{ receiver: unknown, key: string }[]} */
    const calls = []
    /** @type {unknown[]} */
    const replacements = [{ z: 'converted', a: true }, 'converted', -0, NaN, undefined, 1n]
    /* eslint-disable no-extend-native -- Exercise inherited toJSON; restore the original descriptor in finally. */
    try {
      for (const replacement of replacements) {
        Object.defineProperty(Array.prototype, 'toJSON', {
          configurable: true,
          value (/** @type {string} */ key) {
            calls.push({ receiver: this, key })
            return replacement
          },
        })
        calls.length = 0
        const expected = replacement === undefined || typeof replacement === 'bigint' ? null : legacyHash(value)
        calls.length = 0
        const tracker = new WatchDependencyTracker(null, { fullBuild: true })
        tracker.updateGlobalDataFingerprints({ value }, null)
        assert.equal(tracker.state.globalDataFingerprints['value'], expected)
        assert.equal(calls.length, 1)
        assert.equal(calls[0]?.receiver, value)
        assert.equal(calls[0]?.key, '')
        assert.deepEqual([...tracker.updateGlobalDataFingerprints({ value }, tracker.state.globalDataFingerprints)], expected === null ? ['value'] : [])
      }
      Object.defineProperty(Array.prototype, 'toJSON', {
        configurable: true,
        value () { throw new Error('serialization failed') },
      })
      const tracker = new WatchDependencyTracker(null, { fullBuild: true })
      tracker.updateGlobalDataFingerprints({ value }, null)
      assert.equal(tracker.state.globalDataFingerprints['value'], null)
      assert.deepEqual([...tracker.updateGlobalDataFingerprints({ value }, tracker.state.globalDataFingerprints)], ['value'])
    } finally {
      if (previous) Object.defineProperty(Array.prototype, 'toJSON', previous)
      else Reflect.deleteProperty(Array.prototype, 'toJSON')
    }
    /* eslint-enable no-extend-native */
  })

  test('matches seeded nested graphs and preserves stable Unicode collation ties', () => {
    for (let seed = 0; seed < 80; seed++) {
      assertLegacyEquivalent(() => ({ value: seededGraph(seed), events: [] }), `seed ${seed}`)
    }
    assert.equal('é'.localeCompare('e\u0301'), 0)
    assert.equal('Å'.localeCompare('A\u030a'), 0)
    const keys = ['10', '2', '01', '4294967295', '4294967294', 'é', 'e\u0301', 'Å', 'A\u030a', '__proto__']
    const forward = Object.fromEntries(keys.map(key => [key, key]))
    const reverse = Object.fromEntries([...keys].reverse().map(key => [key, key]))
    assert.notEqual(legacyFingerprint(forward), legacyFingerprint(reverse), 'stable collation ties retain insertion order')
    for (const value of [forward, reverse, [forward, reverse, forward]]) {
      assertLegacyEquivalent(() => ({ value, events: [] }), 'Unicode ties and numeric keys')
    }
  })

  test('rejects nested lossy shapes without running accessors or own JSON hooks', () => {
    /** @type {Record<string, (events: string[]) => unknown>} */
    const factories = {
      ...Object.fromEntries(Object.entries(opaquePrimitives).map(([name, value]) => [name, () => value])),
      accessor: events => ({ get value () { events.push('getter'); return 1 } }),
      ownJSONGetter: events => ({ get toJSON () { events.push('toJSON getter'); return () => 1 } }),
      ownJSONMethod: events => ({ toJSON () { events.push('toJSON call'); return 1 } }),
      hidden: () => Object.defineProperty({ a: 1 }, 'hidden', { value: 2 }),
      symbolKey: () => ({ a: 1, [Symbol('key')]: 2 }),
      hiddenSymbol: () => Object.defineProperty({}, Symbol('hidden'), { value: 1 }),
      sparse: () => new Array(3),
      holeWithExtra: () => Object.assign(new Array(2), { 1: 1, extra: 2 }),
      namedArrayProperty: () => Object.assign([1], { extra: 2 }),
      symbolArrayProperty: () => Object.assign([1], { [Symbol('extra')]: 2 }),
      hiddenArrayIndex: () => Object.defineProperty([1], '0', { enumerable: false }),
      arrayAccessor: events => Object.defineProperty([1], '0', { get () { events.push('array getter'); return 1 } }),
      arrayOwnJSON: events => Object.defineProperty([1], 'toJSON', { value () { events.push('array toJSON'); return 1 } }),
      date: () => new Date(0),
      map: () => new Map([['a', 1]]),
      set: () => new Set([1]),
      boxedNumber: () => Object(1),
      boxedString: () => Object('text'),
      boxedBoolean: () => Object(true),
      customObjectPrototype: () => Object.assign(Object.create({ inherited: 1 }), { own: 2 }),
    }
    for (const [name, make] of Object.entries(factories)) {
      /** @type {string[]} */
      const events = []
      const value = { safe: [1, { a: 'first' }], bad: [make(events)] }
      assert.equal(legacyFingerprint(value), null, name)
      assertLegacyEquivalent(() => {
        /** @type {string[]} */
        const events = []
        return { value: { safe: [1, { a: 'first' }], bad: [make(events)] }, events }
      }, name)
      assert.deepEqual(events, [], `${name}: reference must not invoke user code`)
    }
  })

  test('raw JSON preserves legacy numeric canonicalization and string/number separation', t => {
    const rawJSON = Reflect.get(JSON, 'rawJSON')
    if (typeof rawJSON !== 'function') {
      t.skip('JSON.rawJSON is unavailable on this supported Node runtime')
      return
    }
    const cases = [
      { text: '1', canonical: '1' },
      { text: '1.0', canonical: '1' },
      { text: '-0', canonical: '0' },
      { text: '"1"', canonical: '"1"' },
    ]
    for (const { text, canonical } of cases) {
      const raw = rawJSON(text)
      assert.equal(Object.getPrototypeOf(raw), null)
      assert.deepEqual(Reflect.ownKeys(raw), ['rawJSON'])
      assert.equal(Reflect.get(raw, 'rawJSON'), text)
      assert.equal(legacyFingerprint(raw), sha256(canonical), text)
      assertLegacyEquivalent(() => ({ value: rawJSON(text), events: [] }), `raw ${text}: top-level`)
      assertLegacyEquivalent(() => ({ value: { nested: [rawJSON(text)] }, events: [] }), `raw ${text}: nested`)

      const tracker = new WatchDependencyTracker(null, { fullBuild: true })
      const expected = { top: sha256(canonical), object: sha256(`{"nested":${canonical}}`), array: sha256(`[${canonical}]`) }
      const changed = tracker.updateGlobalDataFingerprints({ top: raw, object: { nested: raw }, array: [raw] }, expected)
      assert.deepEqual({ ...tracker.state.globalDataFingerprints }, expected, text)
      assert.deepEqual([...changed], [], text)
    }
  })

  test('raw JSON overflow canonicalizes to JSON null when the API accepts the literal', t => {
    const rawJSON = Reflect.get(JSON, 'rawJSON')
    if (typeof rawJSON !== 'function') {
      t.skip('JSON.rawJSON is unavailable on this supported Node runtime')
      return
    }
    let raw
    try {
      raw = rawJSON('1e400')
    } catch (error) {
      assert.ok(error instanceof SyntaxError)
      t.skip('This JSON.rawJSON implementation rejects the overflow literal 1e400')
      return
    }
    assert.equal(legacyFingerprint(raw), sha256('null'), 'JSON null has a non-null fingerprint')
    assertLegacyEquivalent(() => ({ value: rawJSON('1e400'), events: [] }), 'raw overflow: top-level')
    assertLegacyEquivalent(() => ({ value: { nested: [rawJSON('1e400')] }, events: [] }), 'raw overflow: nested')
  })

  test('raw JSON transitions distinguish ordinary rawJSON properties but normalize numeric spellings', t => {
    const rawJSON = Reflect.get(JSON, 'rawJSON')
    if (typeof rawJSON !== 'function') {
      t.skip('JSON.rawJSON is unavailable on this supported Node runtime')
      return
    }
    /** @type {Record<string, (value: unknown) => unknown>} */
    const wrappers = { top: value => value, object: value => ({ nested: value }), array: value => [value] }
    for (const [name, wrap] of Object.entries(wrappers)) {
      const tracker = new WatchDependencyTracker(null, { fullBuild: true })
      const one = wrap(rawJSON('1'))
      const expected = legacyFingerprint(one)
      assert.notEqual(expected, null)
      assert.deepEqual([...tracker.updateGlobalDataFingerprints({ value: one }, null)], ['value'], name)
      assert.equal(tracker.state.globalDataFingerprints['value'], expected, name)
      assert.deepEqual([...tracker.updateGlobalDataFingerprints({ value: wrap(rawJSON('1.0')) }, tracker.state.globalDataFingerprints)], [], `${name}: 1 -> 1.0`)
      assert.equal(tracker.state.globalDataFingerprints['value'], expected, name)

      const ordinary = wrap({ rawJSON: '1' })
      const ordinaryHash = legacyFingerprint(ordinary)
      assert.notEqual(ordinaryHash, expected, name)
      assert.deepEqual([...tracker.updateGlobalDataFingerprints({ value: ordinary }, tracker.state.globalDataFingerprints)], ['value'], `${name}: raw -> ordinary`)
      assert.equal(tracker.state.globalDataFingerprints['value'], ordinaryHash, name)
      assert.deepEqual([...tracker.updateGlobalDataFingerprints({ value: ordinary }, tracker.state.globalDataFingerprints)], [], `${name}: repeated ordinary`)
      assert.deepEqual([...tracker.updateGlobalDataFingerprints({ value: one }, tracker.state.globalDataFingerprints)], ['value'], `${name}: ordinary -> raw`)
      assert.equal(tracker.state.globalDataFingerprints['value'], expected, name)
      assert.deepEqual([...tracker.updateGlobalDataFingerprints({ value: wrap(rawJSON('"1"')) }, tracker.state.globalDataFingerprints)], ['value'], `${name}: number -> string`)
    }
  })

  test('boxed primitives with null or Object.prototype retain legacy internal-slot behavior', () => {
    const cases = [
      { name: 'true', value: true },
      { name: 'false', value: false },
      { name: 'number', value: 1 },
      { name: 'zero', value: 0 },
      { name: 'negative zero', value: -0 },
      { name: 'nan', value: NaN },
      { name: 'infinity', value: Infinity },
      { name: 'negative infinity', value: -Infinity },
      { name: 'bigint zero', value: 0n },
      { name: 'bigint', value: 9007199254740993n },
      { name: 'empty string', value: '' },
      { name: 'string', value: '1' },
      { name: 'symbol', value: Symbol('boxed') },
    ]
    /** @type {Record<string, (value: unknown) => unknown>} */
    const wrappers = { top: value => value, object: value => ({ nested: value }), array: value => [value] }
    for (const prototype of [null, Object.prototype]) {
      for (const { name, value } of cases) {
        const makeBox = () => Object.setPrototypeOf(Object(value), prototype)
        const expected = legacyFingerprint(makeBox())
        if (typeof value === 'boolean') assert.equal(expected, sha256(String(value)), name)
        if (typeof value === 'number') assert.equal(expected, prototype === null ? null : sha256('null'), name)
        if (typeof value === 'bigint' || typeof value === 'string') assert.equal(expected, null, name)
        if (typeof value === 'symbol') assert.equal(expected, sha256('{}'), name)
        for (const [location, wrap] of Object.entries(wrappers)) {
          const label = `${name}, ${prototype === null ? 'null' : 'Object.prototype'}, ${location}`
          assertLegacyEquivalent(() => ({ value: wrap(makeBox()), events: [] }), label)
        }
      }
      const tracker = new WatchDependencyTracker(null, { fullBuild: true })
      const boxedTrue = Object.setPrototypeOf(Object(true), prototype)
      const boxedFalse = Object.setPrototypeOf(Object(false), prototype)
      tracker.updateGlobalDataFingerprints({ value: boxedTrue }, null)
      assert.deepEqual([...tracker.updateGlobalDataFingerprints({ value: boxedFalse }, tracker.state.globalDataFingerprints)], ['value'])
      assert.equal(tracker.state.globalDataFingerprints['value'], sha256('false'))
      assert.deepEqual([...tracker.updateGlobalDataFingerprints({ value: boxedFalse }, tracker.state.globalDataFingerprints)], [])
    }
  })

  test('retains array subclass, custom prototype, and null-prototype semantics', () => {
    /** @type {Record<string, (events: string[]) => unknown>} */
    const factories = {
      subclass: () => { class Values extends Array {}; return new Values(1, 2, 3) },
      subclassHook: events => {
        class Values extends Array {
          get toJSON () {
            events.push('subclass:get toJSON')
            return function (/** @type {string} */ key) { events.push(`subclass:call ${key}`); return { z: 2, a: 1 } }
          }
        }
        return new Values(1, 2)
      },
      nullArray: () => Object.setPrototypeOf([1, { a: 'value' }], null),
      nullObject: () => Object.assign(Object.create(null), { ['__proto__']: 1, a: [true] }),
      customArray: () => Object.setPrototypeOf([1, 2], { inherited: 'ignored' }),
      customArrayHook: events => Object.setPrototypeOf([1, 2], {
        get toJSON () {
          events.push('custom:get toJSON')
          return function (/** @type {string} */ key) { events.push(`custom:call ${key}`); return 'converted' }
        },
      }),
      throwingArrayHook: events => Object.setPrototypeOf([1], {
        toJSON () { events.push('throw'); throw new Error('hook failed') },
      }),
      customObjectHook: events => Object.assign(Object.create({
        toJSON () { events.push('must not run'); return 1 },
      }), { a: 1 }),
      proxyArrayPrototype: events => Object.setPrototypeOf([1, 2], new Proxy({}, {
        get (target, key, receiver) {
          events.push(`prototype:get ${String(key)}`)
          return Reflect.get(target, key, receiver)
        },
      })),
    }
    for (const [name, make] of Object.entries(factories)) {
      assertLegacyEquivalent(() => {
        /** @type {string[]} */
        const events = []
        const item = make(events)
        return { value: { before: { a: 1 }, items: [item, item] }, events }
      }, name)
    }
  })

  test('global inherited toJSON guards preserve hook counts, order, and transformed results', () => {
    for (const prototype of [Object.prototype, Array.prototype]) {
      const previous = Object.getOwnPropertyDescriptor(prototype, 'toJSON')
      /** @type {string[]} */
      let events = []
      const makeValue = () => ({
        before: { a: 1 },
        list: [{ b: 2 }, [3]],
        nullObject: Object.assign(Object.create(null), { c: 4 }),
        nullArray: Object.setPrototypeOf([5], null),
      })
      try {
        for (const mode of ['identity', 'replacement', 'noncallable', 'undefined', 'throw']) {
          Object.defineProperty(prototype, 'toJSON', {
            configurable: true,
            get () {
              events.push(`get:${Array.isArray(this) ? 'array' : 'object'}`)
              if (mode === 'noncallable') return 7
              /**
               * @this {unknown}
               * @param {string} key
               */
              function toJSON (key) {
                events.push(`call:${key}`)
                if (mode === 'throw') throw new Error('inherited hook failed')
                if (mode === 'undefined') return undefined
                return mode === 'replacement' ? { converted: key } : this
              }
              return toJSON
            },
          })
          events = []
          const expected = legacyFingerprint(makeValue())
          const expectedEvents = [...events]
          assert.ok(expectedEvents.length > 0, mode)
          events = []
          const tracker = new WatchDependencyTracker(null, { fullBuild: true })
          tracker.updateGlobalDataFingerprints({ value: makeValue() }, null)
          assert.deepEqual(events, expectedEvents, `${mode}: hooks must not run twice during fallback`)
          assert.equal(tracker.state.globalDataFingerprints['value'], expected, mode)
        }
      } finally {
        if (previous) Object.defineProperty(prototype, 'toJSON', previous)
        else Reflect.deleteProperty(prototype, 'toJSON')
      }
    }
  })

  test('recognizes toJSON inherited through an altered Array.prototype chain', () => {
    const previous = Object.getPrototypeOf(Array.prototype)
    /** @type {string[]} */
    const events = []
    const prototype = Object.create(previous, {
      toJSON: {
        get () {
          events.push('get toJSON')
          return function (/** @type {string} */ key) { events.push(`call ${key}`); return 'array replacement' }
        },
      },
    })
    try {
      Object.setPrototypeOf(Array.prototype, prototype)
      const makeValue = () => ({ a: [1, 2], b: [[3]] })
      const expected = legacyFingerprint(makeValue())
      const expectedEvents = [...events]
      events.length = 0
      const tracker = new WatchDependencyTracker(null, { fullBuild: true })
      tracker.updateGlobalDataFingerprints({ value: makeValue() }, null)
      assert.equal(tracker.state.globalDataFingerprints['value'], expected)
      assert.deepEqual(events, expectedEvents)
      assert.deepEqual(events, ['get toJSON', 'call a', 'get toJSON', 'call b'])
    } finally {
      Object.setPrototypeOf(Array.prototype, previous)
    }
  })

  test('nested and layered object/array proxies match every legacy trap without speculative reads', () => {
    for (const array of [false, true]) {
      for (const layers of [1, 2]) {
        assertLegacyEquivalent(() => {
          /** @type {string[]} */
          const events = []
          /** @type {object} */
          let value = array ? [1, { a: 2 }] : { z: [1], a: 2 }
          for (let layer = 0; layer < layers; layer++) {
            value = new Proxy(value, {
              getPrototypeOf (target) { events.push(`${layer}:prototype`); return Reflect.getPrototypeOf(target) },
              ownKeys (target) { events.push(`${layer}:keys`); return Reflect.ownKeys(target) },
              getOwnPropertyDescriptor (target, key) { events.push(`${layer}:descriptor:${String(key)}`); return Reflect.getOwnPropertyDescriptor(target, key) },
              get (target, key, receiver) { events.push(`${layer}:get:${String(key)}`); return Reflect.get(target, key, receiver) },
            })
          }
          return { value: { first: { safe: [1, 2] }, nested: [{ value }], alias: value }, events }
        }, `${array ? 'array' : 'object'} proxy layers=${layers}`)
      }
    }
  })

  test('proxy side effects, exceptions, key reordering, and revocation preserve legacy behavior', () => {
    for (const mode of ['mutate', 'reorder', 'throw', 'revoke']) {
      assertLegacyEquivalent(() => {
        /** @type {string[]} */
        const events = []
        const sibling = { value: 'before' }
        const target = { z: 1, a: 2 }
        let visits = 0
        const { proxy, revoke } = Proxy.revocable(target, {
          getPrototypeOf (target) { events.push('prototype'); return Reflect.getPrototypeOf(target) },
          ownKeys (target) {
            events.push(`keys:${++visits}`)
            if (mode === 'throw') throw new Error('ownKeys failed')
            if (mode === 'revoke') revoke()
            if (mode === 'mutate') sibling.value = `visit ${visits}`
            return mode === 'reorder' && visits % 2 === 0 ? ['a', 'z'] : Reflect.ownKeys(target)
          },
          getOwnPropertyDescriptor (target, key) { events.push(`descriptor:${String(key)}`); return Reflect.getOwnPropertyDescriptor(target, key) },
          get (target, key, receiver) {
            events.push(`get:${String(key)}`)

            return Reflect.get(target, key, receiver)
          },
        })
        return { value: { before: sibling, proxy, after: sibling }, events }
      }, mode)
    }
  })

  test('a proxy can install an inherited hook during fallback without changing observation order', () => {
    /** @param {(value: unknown) => string | null} fingerprint */
    function run (fingerprint) {
      const prototype = Object.prototype
      const previous = Object.getOwnPropertyDescriptor(prototype, 'toJSON')
      /** @type {string[]} */
      const events = []
      const proxy = new Proxy({ a: 1 }, {
        get (target, key, receiver) {
          events.push(`get:${String(key)}`)
          if (key === 'toJSON') {
            Object.defineProperty(prototype, 'toJSON', {
              configurable: true,
              value (/** @type {string} */ key) { events.push(`late hook:${key}`); return 'converted' },
            })
          }
          return Reflect.get(target, key, receiver)
        },
      })
      try {
        return { hash: fingerprint({ before: { a: 1 }, proxy, after: { b: 2 } }), events }
      } finally {
        if (previous) Object.defineProperty(prototype, 'toJSON', previous)
        else Reflect.deleteProperty(prototype, 'toJSON')
      }
    }
    const expected = run(legacyFingerprint)
    const actual = run(value => {
      const tracker = new WatchDependencyTracker(null, { fullBuild: true })
      tracker.updateGlobalDataFingerprints({ value }, null)
      return tracker.state.globalDataFingerprints['value'] ?? null
    })
    assert.deepEqual(actual, expected)
    assert.deepEqual(actual.events, ['get:toJSON', 'late hook:proxy', 'late hook:after'])
  })

  test('already-revoked nested proxies are opaque and invalid early siblings suppress later traps', () => {
    for (const array of [false, true]) {
      assertLegacyEquivalent(() => {
        const { proxy, revoke } = Proxy.revocable(array ? [] : {}, {})
        revoke()
        return { value: { nested: [proxy] }, events: [] }
      }, `revoked ${array ? 'array' : 'object'}`)
    }
    assertLegacyEquivalent(() => {
      /** @type {string[]} */
      const events = []
      const proxy = new Proxy({}, {
        getPrototypeOf () { events.push('must not run'); throw new Error('unreachable') },
      })
      return { value: { invalid: undefined, later: proxy }, events }
    }, 'short-circuit before proxy')
  })

  test('depth fallback matches legacy results rather than imposing a supported-depth limit', t => {
    for (const depth of [127, 128, 129, 256, 1024, 16384]) {
      for (const array of [false, true]) {
        /** @type {unknown} */
        let value = { leaf: 'é\ud800' }
        for (let index = 0; index < depth; index++) value = array ? [value] : { next: value }
        const expected = legacyFingerprint(value)
        const tracker = new WatchDependencyTracker(null, { fullBuild: true })
        const parse = t.mock.method(JSON, 'parse')
        let parseCalls
        try {
          tracker.updateGlobalDataFingerprints({ value }, { value: expected })
          parseCalls = parse.mock.callCount()
        } finally {
          parse.mock.restore()
        }
        const label = `${array ? 'array' : 'object'} depth ${depth}`
        assert.equal(tracker.state.globalDataFingerprints['value'], expected, label)
        if (depth >= 128 && expected !== null) assert.equal(parseCalls, 1, `${label}: legacy fallback`)
        assert.deepEqual([...tracker.updateGlobalDataFingerprints({ value }, { value: expected })], expected === null ? ['value'] : [], label)
      }
    }
  })

  test('depth fallback does not double invoke a hook or proxy encountered beyond the threshold', () => {
    assertLegacyEquivalent(() => {
      /** @type {string[]} */
      const events = []
      const customArray = Object.setPrototypeOf([1], {
        get toJSON () {
          events.push('get hook')
          return function (/** @type {string} */ key) { events.push(`call hook:${key}`); return 'converted' }
        },
      })
      /** @type {unknown} */
      let value = new Proxy({ customArray }, {
        getPrototypeOf (target) { events.push('prototype'); return Reflect.getPrototypeOf(target) },
        ownKeys (target) { events.push('keys'); return Reflect.ownKeys(target) },
        getOwnPropertyDescriptor (target, key) { events.push(`descriptor:${String(key)}`); return Reflect.getOwnPropertyDescriptor(target, key) },
        get (target, key, receiver) { events.push(`get:${String(key)}`); return Reflect.get(target, key, receiver) },
      })
      for (let index = 0; index < 140; index++) value = { next: value }
      return { value, events }
    }, 'deep hook/proxy')
  })

  test('preserves proxy safety-traversal order followed by the legacy serializer traps', () => {
    /** @type {string[]} */
    const traps = []
    const value = new Proxy({ z: 1, a: 'two' }, {
      getPrototypeOf (target) {
        traps.push('getPrototypeOf')
        return Reflect.getPrototypeOf(target)
      },
      ownKeys (target) {
        traps.push('ownKeys')
        return Reflect.ownKeys(target)
      },
      getOwnPropertyDescriptor (target, key) {
        traps.push(`getOwnPropertyDescriptor:${String(key)}`)
        return Reflect.getOwnPropertyDescriptor(target, key)
      },
      get (target, key, receiver) {
        traps.push(`get:${String(key)}`)
        return Reflect.get(target, key, receiver)
      },
    })
    const expected = legacyHash(value)
    const serializationTraps = [...traps]
    traps.length = 0
    const tracker = new WatchDependencyTracker(null, { fullBuild: true })
    tracker.updateGlobalDataFingerprints({ value }, null)
    assert.equal(tracker.state.globalDataFingerprints['value'], expected)
    assert.deepEqual(traps, [
      'getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor:z', 'getOwnPropertyDescriptor:a',
      ...serializationTraps,
    ])
  })
})
