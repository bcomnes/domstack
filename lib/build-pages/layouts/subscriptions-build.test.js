import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setupSubscriptions } from './nested-test-helpers.js'

test('each nested renderer gets only its own subscriptions; global data can render unsubscribed inner content', async t => {
  const { domstack, read } = await setupSubscriptions(t)
  const results = await domstack.build()
  assert.equal(results.pageBuildResults?.errors.length, 0)
  for (const file of ['source/index.html', 'markup/index.html', 'typed/index.html', 'archive.html']) {
    const html = await read(file)
    assert.match(html, /nav-v1/)
    assert.match(html, /recent-v1/)
    assert.match(html, /footer-v1/)
    assert.match(html, /Content/)
  }
  assert.match(await read('typed/index.html'), /message-v1/)
})
