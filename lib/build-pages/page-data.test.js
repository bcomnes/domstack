import { test } from 'node:test'
import assert from 'node:assert'
import { PageData } from './page-data.js'

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
