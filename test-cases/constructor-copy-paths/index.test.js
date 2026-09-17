/** @import { DomStackOpts } from '../../lib/builder.js' */
import { test } from 'node:test'
import assert from 'node:assert'
import { isAbsolute, resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { DomStack } from '../../index.js'

const tmpSrc = join(tmpdir(), 'domstack-test-src')
const tmpDest = join(tmpdir(), 'domstack-test-dest')

for (const { name, options, expected } of [
  { name: 'omitted', options: {}, expected: [] },
  { name: 'undefined', options: { ignore: undefined }, expected: [] },
  { name: 'null', options: { ignore: null }, expected: [] },
  { name: 'empty array', options: { ignore: [] }, expected: [] },
  { name: 'array', options: { ignore: ['private', '*.secret'] }, expected: ['private', '*.secret'] },
  { name: 'single string', options: { ignore: 'private' }, expected: ['private'] },
]) {
  test(`DomStack constructor normalizes ${name} ignore options`, () => {
    const defaults = new DomStack(tmpSrc, tmpDest).opts.ignore ?? []
    // JavaScript callers have historically been able to pass null or a single string.
    const ds = new DomStack(tmpSrc, tmpDest, /** @type {DomStackOpts} */ (options))
    assert.deepStrictEqual(ds.opts.ignore, [...defaults, ...expected])
    if (Array.isArray(options.ignore)) {
      assert.deepStrictEqual(options.ignore, expected, 'the caller\'s array is not mutated')
      assert.notStrictEqual(ds.opts.ignore, options.ignore)
    }
  })
}

test.describe('DomStack constructor - copy path resolution', () => {
  test('resolves a relative copy path to an absolute path', () => {
    const ds = new DomStack(tmpSrc, tmpDest, {
      copy: ['some-relative-copy-dir'],
    })

    const copy = ds.opts.copy ?? []
    assert.strictEqual(copy.length, 1, 'one copy entry')
    const copyPath = /** @type {string} */ (copy[0])
    assert.ok(isAbsolute(copyPath), `copy path should be absolute, got: "${copyPath}"`)
  })

  test('leaves an already-absolute copy path normalized', () => {
    const absPath = join(tmpdir(), 'absolute', 'copy', 'dir')
    const ds = new DomStack(tmpSrc, tmpDest, {
      copy: [absPath],
    })

    const copy = ds.opts.copy ?? []
    assert.strictEqual(copy[0], resolve(absPath), 'absolute path is preserved and normalized')
  })

  test('resolves multiple mixed copy paths', () => {
    const absPath = join(tmpdir(), 'absolute', 'dir')
    const ds = new DomStack(tmpSrc, tmpDest, {
      copy: ['relative-dir', absPath],
    })

    const copy = ds.opts.copy ?? []
    assert.strictEqual(copy.length, 2, 'two copy entries')
    for (const p of copy) {
      assert.ok(isAbsolute(p), `each copy path should be absolute, got: "${p}"`)
    }
  })
})
