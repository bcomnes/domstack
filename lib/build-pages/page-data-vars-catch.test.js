import { test } from 'node:test'
import assert from 'node:assert'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PageData } from './page-data.js'

const fakeLayout = {
  render: async ({ children }) => String(children),
  layoutStylePath: null,
  layoutClientPath: null,
}

test.describe('PageData.vars catch block wrapping', () => {
  test('wraps error from spread merge with page path and preserves cause', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'domstack-pagedata-test-'))
    const mdFile = join(dir, 'test.md')

    try {
      await writeFile(mdFile, '# Test\n\nContent.')

      const pd = new PageData({
        pageInfo: /** @type {any} */ ({
          path: 'blog/post',
          outputName: 'index.html',
          type: 'md',
          pageFile: { filepath: mdFile },
        }),
        globalVars: { layout: 'default' },
        globalStyle: undefined,
        globalClient: undefined,
        defaultStyle: null,
        defaultClient: null,
        builderOptions: /** @type {any} */ ({}),
      })

      await pd.init({ layouts: { default: fakeLayout } })

      // After init, replace pageVars with a proxy that throws on property access
      // to trigger the catch block in the vars getter.
      const originalError = new Error('getter exploded')
      pd.pageVars = new Proxy({}, {
        ownKeys: () => ['exploding-key'],
        getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true, writable: true, value: undefined }),
        get (_target, key) {
          if (typeof key === 'symbol') return undefined
          throw originalError
        },
      })

      assert.throws(
        () => pd.vars,
        (err) => {
          assert.ok(err instanceof Error, 'throws an Error')
          assert.ok(
            err.message.includes('blog/post'),
            `message should include page path, got: "${err.message}"`
          )
          assert.ok(
            err.message.includes('getter exploded'),
            `message should include original error message, got: "${err.message}"`
          )
          assert.strictEqual(err.cause, originalError, 'err.cause should be the original error')
          return true
        }
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
