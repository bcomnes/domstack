import { test } from 'node:test'
import assert from 'node:assert'
import { DomStack } from '../../index.js'
import * as path from 'path'
import { rm } from 'fs/promises'

const __dirname = import.meta.dirname

test.describe('page-build-errors', () => {
  test('should handle page build errors correctly', async () => {
    const src = path.join(__dirname, './src')
    const dest = path.join(__dirname, './public')
    const siteUp = new DomStack(src, dest)

    await rm(dest, { recursive: true, force: true })

    try {
      const results = await siteUp.build()
      assert.ok(!results, 'Build should fail, and not generate results')
    } catch (err) {
      assert.match(err.message, /Build finished but there were errors/, 'Should have an error message about a filed build.')
      assert.ok(Array.isArray(err.errors), 'Should have an array of errors')

      const pageResolveError = err.errors.find(err => err.message.includes('Error resolving page vars'))
      const nestedPageResolveError = err.errors.find(err => err.page?.path === 'another-broken-page')

      assert.ok(pageResolveError, 'Should include a page resolve build error')
      assert.ok(pageResolveError.cause, 'Should include an error cause')
      assert.ok(nestedPageResolveError, 'Should include a page resolve build error for the nested broken page')
      assert.match(nestedPageResolveError.message, /page: "another-broken-page"/, 'Should include the page path in the error message')
    }
  })
})
