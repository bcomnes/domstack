import { test } from 'node:test'
import assert from 'node:assert'
import { testBuild } from '../../index.js'
import { identifyPages } from '../../lib/identify-pages.js'
import * as path from 'path'

const __dirname = import.meta.dirname

test.describe('default-layout', () => {
  test('warns about a missing root layout without specifying an extension', async () => {
    const { warnings } = await identifyPages(path.join(__dirname, './src'))

    assert.deepStrictEqual(warnings.find(warning => warning.code === 'DOM_STACK_WARNING_NO_ROOT_LAYOUT'), {
      code: 'DOM_STACK_WARNING_NO_ROOT_LAYOUT',
      message: 'Missing a root layout file. Using default layout file.',
    })
  })

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
