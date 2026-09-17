/**
 * @import { PageInfo } from '../../identify-pages.js'
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PageSubscriptions } from './page-subscriptions.js'
import { DomStackDataError } from '../../helpers/domstack-error.js'

const pageInfo = /** @type {PageInfo} */ ({ pageFile: { relname: 'blog/page.js' } })

test('keeps page and layout access narrower than the invalidation union', () => {
  const subscriptions = new PageSubscriptions()
  subscriptions.setPageDependencies(['posts', 'shared'], ['shared'])
  subscriptions.addLayout('root', ['navigation', 'shared'])
  subscriptions.addLayout('article', ['author'])
  assert.deepEqual(subscriptions.dependencies, ['author', 'navigation', 'posts', 'shared'])

  const posts = [{ title: 'First' }]
  subscriptions.bind({ posts, shared: true, navigation: ['Home'], author: 'Author' }, pageInfo)
  const page = subscriptions.getPageData(pageInfo)
  const root = subscriptions.getLayoutData('root', pageInfo)
  assert.ok(root)
  assert.deepEqual(Object.keys(page), ['posts', 'shared'])
  assert.deepEqual(Object.keys(root), ['navigation', 'shared'])
  assert.throws(() => page['navigation'], { code: 'DOM_STACK_ERROR_DATA' })
  assert.throws(() => root['posts'], { code: 'DOM_STACK_ERROR_DATA' })
  assert.equal(Object.isFrozen(page), true)
  assert.equal(page['posts'], posts, 'published nested values remain shared, not cloned')
  assert.equal(Object.isFrozen(posts), false)
})

test('guards only declared data before binding and preserves readiness error metadata', () => {
  const subscriptions = new PageSubscriptions()
  subscriptions.addLayout('root', ['navigation'])
  assert.deepEqual(subscriptions.getPageData(pageInfo), {})
  assert.equal(subscriptions.getLayoutData('missing', pageInfo), undefined)
  assert.throws(() => subscriptions.getLayoutData('root', pageInfo), error => {
    assert.ok(error instanceof DomStackDataError)
    assert.deepEqual(error.dataDependency, { reason: 'NOT_READY', consumer: 'Page "blog/page.js"' })
    return true
  })
  assert.throws(() => subscriptions.assertReady(subscriptions.dependencies, pageInfo), /Global data is not available/)
  subscriptions.bind({ navigation: [] }, pageInfo)
  assert.doesNotThrow(() => subscriptions.assertReady(subscriptions.dependencies, pageInfo))
})

test('a failed first binding remains unready and can be retried', () => {
  const subscriptions = new PageSubscriptions()
  subscriptions.setPageDependencies(['posts'], [])
  subscriptions.addLayout('root', ['navigation'])
  assert.throws(() => subscriptions.bind({ posts: [] }, pageInfo), error => {
    assert.ok(error instanceof DomStackDataError)
    assert.deepEqual(error.dataDependency, { reason: 'MISSING_KEY', consumer: 'Layout "root"', key: 'navigation' })
    return true
  })
  assert.throws(() => subscriptions.getPageData(pageInfo), /Global data is not available/)
  subscriptions.bind({ posts: ['recovered'], navigation: [] }, pageInfo)
  assert.deepEqual(subscriptions.getPageData(pageInfo)['posts'], ['recovered'])
})
