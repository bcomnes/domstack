import { test } from 'node:test'
import assert from 'node:assert'
import { isAbsolute, resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { DomStack } from '../../index.js'

const tmpSrc = join(tmpdir(), 'domstack-test-src')
const tmpDest = join(tmpdir(), 'domstack-test-dest')

test.describe('DomStack constructor - copy path resolution', () => {
  test('resolves a relative copy path to an absolute path', () => {
    const ds = new DomStack(tmpSrc, tmpDest, {
      copy: ['some-relative-copy-dir'],
    })

    assert.strictEqual(ds.opts.copy.length, 1, 'one copy entry')
    assert.ok(isAbsolute(ds.opts.copy[0]), `copy path should be absolute, got: "${ds.opts.copy[0]}"`)
  })

  test('leaves an already-absolute copy path normalized', () => {
    const absPath = join(tmpdir(), 'absolute', 'copy', 'dir')
    const ds = new DomStack(tmpSrc, tmpDest, {
      copy: [absPath],
    })

    assert.strictEqual(ds.opts.copy[0], resolve(absPath), 'absolute path is preserved and normalized')
  })

  test('resolves multiple mixed copy paths', () => {
    const absPath = join(tmpdir(), 'absolute', 'dir')
    const ds = new DomStack(tmpSrc, tmpDest, {
      copy: ['relative-dir', absPath],
    })

    assert.strictEqual(ds.opts.copy.length, 2, 'two copy entries')
    for (const p of ds.opts.copy) {
      assert.ok(isAbsolute(p), `each copy path should be absolute, got: "${p}"`)
    }
  })
})
