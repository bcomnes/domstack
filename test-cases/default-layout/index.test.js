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

    const indexHtml = await build.readOutput('index.html')
    const noDefaultStyleHtml = await build.readOutput('no-default-style/index.html')

    assert.match(indexHtml, /<main class="mine-layout app-main">/, 'default layout wraps content in main')
    assert.match(indexHtml, /<h1[^>]*>Default layout title<\/h1>/, 'markdown content is inserted as trusted html')
    assert.match(indexHtml, /<link rel="stylesheet" href="\/domstack-defaults\/default.style.css-[^"]+\.css"/, 'default style is included by default')
    assert.doesNotMatch(indexHtml, /&lt;h1&gt;Default layout title&lt;\/h1&gt;/, 'markdown content is not escaped')
    assert.doesNotMatch(noDefaultStyleHtml, /\/domstack-defaults\/default.style.css/, 'default style can be disabled')
  })
})
