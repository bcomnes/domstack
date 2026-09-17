import assert from 'node:assert/strict'
import { test } from 'node:test'
import { join } from 'node:path'
import { testBuild } from '../../index.js'

test('page-output example publishes HTML, raw Markdown, and subscribed metadata', async t => {
  const build = await testBuild(join(import.meta.dirname, 'src'))
  t.after(() => build.cleanup())
  assert.match(await build.readOutput('article/index.html'), /<main>\s*<h1[^>]*>An article with sidecars<\/h1>/)
  const markdown = await build.readOutput('article/source.md')
  assert.match(markdown, /# An article with sidecars/)
  assert.doesNotMatch(markdown, /title:|<h1/)
  assert.deepEqual(JSON.parse(await build.readOutput('article/metadata.json')), {
    title: 'An article with sidecars', url: '/article/', edition: 'Example edition',
  })
  assert.deepEqual(build.results.pageBuildResults?.outputs.map(output => output.outputRelname).sort(), [
    'article/index.html', 'article/metadata.json', 'article/source.md',
  ])
})
