import { test } from 'node:test'
import assert from 'node:assert'
import { computePageUrl } from './compute-page-url.js'

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
