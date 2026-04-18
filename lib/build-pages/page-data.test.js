/**
 * @import { PageInfo } from '../identify-pages.js'
 * @import { ResolvedLayout } from './page-data.js'
 * @import { BuilderOptions } from './page-builders/page-writer.js'
 */

import { test } from 'node:test'
import assert from 'node:assert'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PageData } from './page-data.js'
import { computePageUrl } from './compute-page-url.js'

/**
 * @typedef {Record<string, unknown> & { layout: string, title?: string, fromGlobalData?: boolean }} TestVars
 */

/** @type {BuilderOptions} */
const builderOptions = {}

/** @type {ResolvedLayout<TestVars, string, string>} */
const fakeLayout = {
  name: 'default',
  render: async ({ children }) => String(children),
  layoutStylePath: null,
  layoutClientPath: null,
}

/**
 * @param {string} filepath
 * @returns {PageInfo}
 */
function mdPageInfo (filepath) {
  return {
    pageFile: {
      root: '',
      filepath,
      relname: 'blog/post/test.md',
      basename: 'test.md',
      parentName: 'blog/post',
      type: 'md',
    },
    type: 'md',
    path: 'blog/post',
    url: '/blog/post/',
    outputName: 'index.html',
    outputRelname: 'blog/post/index.html',
    draft: false,
  }
}

test.describe('PageData.vars', () => {
  test('returns a cached, frozen vars object and invalidates when sources change', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'domstack-pagedata-cache-test-'))
    const mdFile = join(dir, 'test.md')

    try {
      await writeFile(mdFile, '# Test\n\nContent.')

      /** @type {PageData<TestVars, string, string>} */
      const pd = new PageData({
        pageInfo: mdPageInfo(mdFile),
        globalVars: { layout: 'default', title: 'Global title' },
        globalStyle: undefined,
        globalClient: undefined,
        defaultStyle: null,
        defaultClient: null,
        builderOptions,
      })

      await pd.init({ layouts: { default: fakeLayout } })

      const vars = pd.vars
      assert.strictEqual(pd.vars, vars, 'repeated access should return the cached object')
      assert.strictEqual(Object.isFrozen(vars), true, 'cached vars should be frozen')
      assert.strictEqual(vars.title, 'Test')
      assert.throws(() => {
        vars.title = 'Mutated title'
      }, TypeError)
      assert.strictEqual(vars.title, 'Test')

      pd.globalDataVars = { fromGlobalData: true }

      const updatedVars = pd.vars
      assert.notStrictEqual(updatedVars, vars, 'replacing a source object should invalidate the cache')
      assert.strictEqual(Object.isFrozen(updatedVars), true, 'updated cached vars should be frozen')
      assert.strictEqual(updatedVars.fromGlobalData, true)
      assert.strictEqual(updatedVars.title, 'Test')
      assert.strictEqual(pd.vars, updatedVars, 'updated vars should be cached')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('reads markdown content without front matter', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'domstack-pagedata-md-content-test-'))
    const mdFile = join(dir, 'test.md')

    try {
      await writeFile(mdFile, '---\ntitle: Front matter title\n---\n# Markdown title\n\nContent.')

      const pd = new PageData({
        pageInfo: mdPageInfo(mdFile),
        globalVars: {},
        globalStyle: undefined,
        globalClient: undefined,
        defaultStyle: null,
        defaultClient: null,
        builderOptions,
      })

      assert.strictEqual(await pd.readMarkdownContent(), '\n# Markdown title\n\nContent.')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('rejects markdown content reads for non-markdown pages', async () => {
    const pageInfo = mdPageInfo('test.html')
    pageInfo.type = 'html'
    pageInfo.pageFile.type = 'html'

    const pd = new PageData({
      pageInfo,
      globalVars: {},
      globalStyle: undefined,
      globalClient: undefined,
      defaultStyle: null,
      defaultClient: null,
      builderOptions,
    })

    await assert.rejects(
      () => pd.readMarkdownContent(),
      /Markdown content can only be read from markdown pages/
    )
  })

  test('throws with page path before initialization', () => {
    const pd = new PageData({
      pageInfo: {
        ...mdPageInfo('test.md'),
        path: 'blog/test-post',
      },
      globalVars: {},
      globalStyle: undefined,
      globalClient: undefined,
      defaultStyle: null,
      defaultClient: null,
      builderOptions,
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
      pageInfo: /** @type {PageInfo} */ (/** @type {unknown} */ ({})),
      globalVars: {},
      globalStyle: undefined,
      globalClient: undefined,
      defaultStyle: null,
      defaultClient: null,
      builderOptions,
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
