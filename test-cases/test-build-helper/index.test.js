import { test } from 'node:test'
import assert from 'node:assert'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'

import { testBuild } from '../../index.js'

const __dirname = import.meta.dirname

test.describe('testBuild', () => {
  test('builds into a temporary directory and provides output helpers', async () => {
    const src = join(__dirname, 'src')
    const copy = join(__dirname, 'copyfolder')
    const build = await testBuild(src, { copy: [copy] })

    try {
      assert.match(build.dest, /domstack-test-/, 'uses a domstack temp destination')
      assert.ok(build.results, 'returns build results')

      const html = await build.readOutput('index.html')
      assert.match(html, /Test helper page/, 'reads generated page output')

      const copied = await build.readOutput('copied.txt')
      assert.strictEqual(copied, 'copied by testBuild\n', 'passes copy options through to DomStack')
    } finally {
      await build.cleanup()
    }

    await assert.rejects(stat(build.dest), 'cleanup removes the temporary destination')
  })
})
