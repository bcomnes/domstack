import { test } from 'node:test'
import assert from 'node:assert/strict'
import { testBuild } from '../../index.js'
import { join } from 'node:path'

test('nested layouts render source and generated pages, cascade vars and preserve intermediate values', async t => {
  const build = await testBuild(join(import.meta.dirname, 'src'))
  t.after(() => build.cleanup())
  const { results, readOutput: read } = build
  assert.equal(results.pageBuildResults?.errors.length, 0)
  for (const [output, title] of [['source/index.html', 'source'], ['typed/index.html', 'typed'], ['markup/index.html', 'markup'], ['archive.html', 'archive']]) {
    const html = await read(/** @type {string} */ (output))
    assert.match(html, new RegExp(`data-vars="root:article:${title}"`))
    assert.match(html, /<article>\s*<section>/)
    assert.equal((html.match(/<html>/g) ?? []).length, 1, 'the root layout runs once')
    assert.equal((html.match(/<article>/g) ?? []).length, 1, 'the middle layout runs once')
    assert.equal((html.match(/<section>/g) ?? []).length, 1, 'the inner layout runs once')
    const styles = [...html.matchAll(/<link href="([^"]+)"/g)].map(match => match[1]?.replace(/-[A-Z0-9]+\./, '.'))
    assert.deepEqual(styles, ['/global.css', '/root.layout.css', '/article.layout.css', '/post.layout.css', ...(title === 'source' ? ['./style.css'] : [])])
    const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(match => match[1]?.replace(/-[A-Z0-9]+\./, '.'))
    assert.deepEqual(scripts, ['/global.client.js', '/root.layout.client.js', '/article.layout.client.js', '/post.layout.client.js', ...(title === 'source' ? ['./client.js'] : [])])
  }
  assert.match(await read('plain/index.html'), /<aside>/)
})
