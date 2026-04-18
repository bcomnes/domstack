import { test } from 'node:test'
import assert from 'node:assert'
import { isAbsolute } from 'node:path'
import { DomStack } from '../../index.js'

test.describe('DomStack constructor - copy path resolution', () => {
  test('resolves a relative copy path to an absolute path', () => {
    const ds = new DomStack('/tmp/test-src', '/tmp/test-dest', {
      copy: ['some-relative-copy-dir'],
    })

    assert.strictEqual(ds.opts.copy.length, 1, 'one copy entry')
    assert.ok(isAbsolute(ds.opts.copy[0]), `copy path should be absolute, got: "${ds.opts.copy[0]}"`)
  })

  test('leaves an already-absolute copy path unchanged', () => {
    const ds = new DomStack('/tmp/test-src', '/tmp/test-dest', {
      copy: ['/absolute/copy/dir'],
    })

    assert.strictEqual(ds.opts.copy[0], '/absolute/copy/dir', 'absolute path is preserved')
  })

  test('resolves multiple mixed copy paths', () => {
    const ds = new DomStack('/tmp/test-src', '/tmp/test-dest', {
      copy: ['relative-dir', '/absolute/dir'],
    })

    assert.strictEqual(ds.opts.copy.length, 2, 'two copy entries')
    for (const p of ds.opts.copy) {
      assert.ok(isAbsolute(p), `each copy path should be absolute, got: "${p}"`)
    }
  })
})
