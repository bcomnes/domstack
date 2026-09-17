import { test } from 'node:test'
import assert from 'node:assert/strict'
import globalData from './src/global.data.js'

/**
 * @param {any[]} pages
 */
function collectRedirects (pages) {
  const data = globalData(/** @type {any} */ ({ pages }))
  if (data instanceof Promise) throw new TypeError('Expected synchronous global data')
  return data.redirects
}

test('validates page-owned redirect metadata with destination context', () => {
  /**
     * @param {string} relname
     * @param {string} url
     * @param {unknown} redirectFrom
     */
  const page = (relname, url, redirectFrom) => /** @type {any} */ ({
    vars: { redirectFrom },
    pageInfo: { path: relname.replace(/\/README\.md$/, ''), url, pageFile: { relname } },
  })

  assert.deepEqual(collectRedirects([
    page('current/README.md', '/current/', ['/old/', '/older/']),
  ]), [
    { from: '/old/', to: '/current/' },
    { from: '/older/', to: '/current/' },
  ])

  assert.throws(
    () => collectRedirects([page('string/README.md', '/string/', '/old/')]),
    /redirectFrom on "string\/README\.md" must be an array/
  )
  assert.throws(
    () => collectRedirects([page('number/README.md', '/number/', [42])]),
    /redirectFrom entries on "number\/README\.md" must be strings/
  )

  for (const redirectFrom of ['https://example.com/old/', '//example.com/old/', '/old/?draft=true', '/../escape/']) {
    assert.throws(
      () => collectRedirects([page('invalid/README.md', '/invalid/', [redirectFrom])]),
      error => error instanceof Error && error.message.includes(redirectFrom) && error.message.includes('invalid/README.md')
    )
  }

  assert.throws(
    () => collectRedirects([
      page('first/README.md', '/first/', ['/shared-old/']),
      page('second/README.md', '/second/', ['/shared-old/']),
    ]),
    /redirectFrom "\/shared-old\/" is declared by both "first\/README\.md" and "second\/README\.md"/
  )
})
