import { test } from 'node:test'
import assert from 'node:assert'
import { testBuild } from '../../index.js'
import * as path from 'path'

const __dirname = import.meta.dirname

test.describe('default-layout', () => {
  test('should build site with default layout', async (t) => {
    const src = path.join(__dirname, './src')
    const build = await testBuild(src)

    t.after(async () => {
      await build.cleanup()
    })

    assert.ok(build.results, 'built with default layout')
  })
})
