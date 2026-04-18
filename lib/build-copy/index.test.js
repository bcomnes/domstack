import { test } from 'node:test'
import assert from 'node:assert'
import { getCopyDirs } from './index.js'

test.describe('build-copy', () => {
  test('getCopyDirs appends ** for non-existent paths', async () => {
    const copyDirs = await getCopyDirs(['fixtures'])

    assert.deepStrictEqual(copyDirs, ['fixtures/**'])
  })
})
