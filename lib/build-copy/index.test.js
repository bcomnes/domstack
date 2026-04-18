import { test } from 'node:test'
import assert from 'node:assert'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import os from 'node:os'
import { getCopyDirs } from './index.js'

test.describe('build-copy', () => {
  test('getCopyDirs appends ** for non-existent paths', async () => {
    const copyDirs = await getCopyDirs(['fixtures'])

    assert.deepStrictEqual(copyDirs, ['fixtures/**'])
  })

  test('getCopyDirs returns file path as-is for existing files', async () => {
    const dir = await mkdtemp(join(os.tmpdir(), 'domstack-copy-test-'))
    const file = join(dir, 'sw.js')
    try {
      await writeFile(file, 'self.addEventListener("fetch", () => {})')
      const result = await getCopyDirs([file])
      assert.deepStrictEqual(result, [file])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('getCopyDirs appends ** for existing directories', async () => {
    const dir = await mkdtemp(join(os.tmpdir(), 'domstack-copy-test-'))
    try {
      const result = await getCopyDirs([dir])
      assert.deepStrictEqual(result, [join(dir, '**')])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
