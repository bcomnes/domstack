import { test } from 'node:test'
import assert from 'node:assert'
import { PageData } from './page-data.js'
import { computePageUrl } from './compute-page-url.js'

test.describe('PageData.vars', () => {
  test('throws with page path before initialization', () => {
    const pd = new PageData({
      pageInfo: /** @type {any} */ ({ path: 'blog/test-post' }),
      globalVars: {},
      globalStyle: undefined,
      globalClient: undefined,
      defaultStyle: null,
      defaultClient: null,
      builderOptions: /** @type {any} */ ({}),
    })

    assert.throws(
      () => pd.vars,
      (err) => {
        assert.ok(err instanceof Error, 'throws an Error')
        assert.ok(
          err.message.includes('blog/test-post'),
          `error message should include the page path, got: "${err.message}"`
        )
        return true
      }
    )
  })

  test('error message includes unknown page fallback when pageInfo has no path', () => {
    const pd = new PageData({
      pageInfo: /** @type {any} */ ({}),
      globalVars: {},
      globalStyle: undefined,
      globalClient: undefined,
      defaultStyle: null,
      defaultClient: null,
      builderOptions: /** @type {any} */ ({}),
    })

    assert.throws(
      () => pd.vars,
      (err) => {
        assert.ok(err instanceof Error, 'throws an Error')
        assert.ok(
          err.message.includes('<unknown page>'),
          `error message should include fallback text, got: "${err.message}"`
        )
        return true
      }
    )
  })
})

test.describe('computePageUrl', () => {
  test('root index.html maps to /', () => {
    assert.strictEqual(computePageUrl({ path: '', outputName: 'index.html' }), '/')
  })

  test('nested index.html gets a trailing-slash URL', () => {
    assert.strictEqual(computePageUrl({ path: 'blog/post', outputName: 'index.html' }), '/blog/post/')
  })

  test('non-index output includes filename in URL', () => {
    assert.strictEqual(computePageUrl({ path: 'md-page', outputName: 'loose-md.html' }), '/md-page/loose-md.html')
  })

  test('non-index file at root includes filename only', () => {
    assert.strictEqual(computePageUrl({ path: '', outputName: 'robots.txt' }), '/robots.txt')
  })
})
