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
import { PageData, resolveLayout } from './page-data.js'
import { computePageUrl } from './compute-page-url.js'

/**
 * @typedef {Record<string, unknown> & { layout: string, title?: string, fromGlobal?: string, fromLayout?: string, fromPage?: string }} TestVars
 */

/** @type {BuilderOptions} */
const builderOptions = {}

/** @type {ResolvedLayout<TestVars, string, string>} */
const fakeLayout = {
  name: 'default',
  render: async ({ children }) => String(children),
  vars: {},
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

      pd.layoutVars = [{ name: 'default', vars: { fromLayout: 'updated layout' } }]

      const updatedVars = pd.vars
      assert.notStrictEqual(updatedVars, vars, 'replacing a source object should invalidate the cache')
      assert.strictEqual(Object.isFrozen(updatedVars), true, 'updated cached vars should be frozen')
      assert.strictEqual(updatedVars.fromLayout, 'updated layout')
      assert.strictEqual(updatedVars.title, 'Test')
      assert.strictEqual(pd.vars, updatedVars, 'updated vars should be cached')

      const layer = pd.layoutVars[0]
      assert.ok(layer)
      layer.vars = { fromLayout: 'replaced layer vars' }
      const replacedVars = pd.vars
      assert.notStrictEqual(replacedVars, updatedVars, 'replacing a layer vars object should invalidate the cache')
      assert.strictEqual(replacedVars.fromLayout, 'replaced layer vars')

      pd.layoutVars.push({ name: 'inner', vars: { fromLayout: 'inner value' } })
      const addedVars = pd.vars
      assert.notStrictEqual(addedVars, replacedVars)
      assert.strictEqual(addedVars.fromLayout, 'inner value')

      pd.layoutVars.reverse()
      const reorderedVars = pd.vars
      assert.notStrictEqual(reorderedVars, addedVars)
      assert.strictEqual(reorderedVars.fromLayout, 'replaced layer vars')

      pd.layoutVars.pop()
      const removedVars = pd.vars
      assert.notStrictEqual(removedVars, reorderedVars)
      assert.strictEqual(removedVars.fromLayout, 'inner value')

      pd.layoutVars = []
      assert.strictEqual(pd.vars.fromLayout, undefined, 'removing all layers should drop their values')
      assert.strictEqual(pd.vars.title, 'Test')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('resolves layout vars exports', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'domstack-resolve-layout-vars-test-'))
    const layoutFile = join(dir, 'test.layout.mjs')

    try {
      await writeFile(layoutFile, `export const vars = async () => ({ fromLayout: 'layout vars' })
export default function layout ({ children }) { return String(children) }
`)

      const layout = await resolveLayout(layoutFile)
      const layoutVars = /** @type {{ fromLayout?: unknown }} */ (layout.vars)
      assert.strictEqual(layoutVars.fromLayout, 'layout vars')
      assert.strictEqual(typeof layout.render, 'function')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('preserves every layout vars layer while merging between global and page vars', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'domstack-pagedata-layout-vars-test-'))
    const mdFile = join(dir, 'test.md')
    const pageVarsFile = join(dir, 'page.vars.js')

    try {
      await writeFile(mdFile, '---\ntitle: Frontmatter title\nfromLayout: frontmatter overrides layout\n---\n# Markdown title\n\nContent.')
      await writeFile(pageVarsFile, `export default {
  fromPage: 'page vars',
  fromGlobal: 'page overrides global vars'
}\n`)

      /** @type {ResolvedLayout<TestVars, string, string>} */
      const layout = {
        name: 'default',
        parentLayout: 'empty',
        render: async ({ children }) => String(children),
        vars: {
          fromGlobal: 'layout overrides global',
          layoutWins: 'layout value',
          fromLayout: 'layout vars',
          fromPage: 'layout default',
        },
        layoutStylePath: null,
        layoutClientPath: null,
      }

      /** @type {PageData<TestVars, string, string>} */
      const pd = new PageData({
        pageInfo: {
          ...mdPageInfo(mdFile),
          pageVars: {
            root: dir,
            filepath: pageVarsFile,
            relname: 'blog/post/page.vars.js',
            basename: 'page.vars.js',
            parentName: 'blog/post',
          },
        },
        globalVars: {
          layout: 'default',
          fromGlobal: 'global vars',
          layoutWins: 'global value',
        },
        globalStyle: undefined,
        globalClient: undefined,
        defaultStyle: null,
        defaultClient: null,
        builderOptions,
      })

      const root = {
        ...fakeLayout,
        name: 'root',
        vars: { layoutWins: 'root value', rootOnly: 'inherited', dataDeps: ['navigation'] },
      }
      const empty = { ...fakeLayout, name: 'empty', parentLayout: 'root' }
      delete empty.vars
      const layouts = { root, empty, default: layout }
      await pd.init({ layouts })
      await pd.init({ layouts })

      assert.deepEqual(pd.layoutVars, [
        { name: 'root', vars: { layoutWins: 'root value', rootOnly: 'inherited' } },
        { name: 'empty', vars: {} },
        { name: 'default', vars: layout.vars },
      ], 'retain overridden values and empty layers in outermost-to-innermost order, without duplicating on repeated init')
      assert.deepEqual(root.vars.dataDeps, ['navigation'], 'dependency extraction should not modify the layout export')
      assert.deepEqual(pd.dataDeps, ['navigation'])
      assert.strictEqual('dataDeps' in pd.vars, false)
      assert.strictEqual(pd.vars['rootOnly'], 'inherited')
      assert.strictEqual(pd.vars['fromGlobal'], 'page overrides global vars')
      assert.strictEqual(pd.vars['layoutWins'], 'layout value', 'layout defaults override global vars when the page does not override them')
      assert.strictEqual(pd.vars['fromLayout'], 'frontmatter overrides layout')
      assert.strictEqual(pd.vars['fromPage'], 'page vars')
      assert.strictEqual(pd.vars['title'], 'Frontmatter title')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('uses the full variable cascade to select default assets during initialization', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'domstack-pagedata-default-assets-test-'))
    const mdFile = join(dir, 'test.md')

    try {
      for (const { rootStyle, innerVars, frontmatter, enabled } of [
        { rootStyle: true, innerVars: {}, frontmatter: '', enabled: true },
        { rootStyle: false, innerVars: { defaultStyle: true }, frontmatter: '', enabled: true },
        { rootStyle: true, innerVars: { defaultStyle: false }, frontmatter: '', enabled: false },
        { rootStyle: true, innerVars: {}, frontmatter: '---\ndefaultStyle: false\n---\n', enabled: false },
      ]) {
        await writeFile(mdFile, `${frontmatter}# Test\n`)
        /** @type {PageData<TestVars, string, string>} */
        const pd = new PageData({
          pageInfo: mdPageInfo(mdFile),
          globalVars: { layout: 'inner', defaultStyle: false },
          globalStyle: undefined,
          globalClient: undefined,
          defaultStyle: 'default.css',
          defaultClient: 'default.js',
          builderOptions,
        })
        await pd.init({
          layouts: {
            root: { ...fakeLayout, name: 'root', vars: { defaultStyle: rootStyle } },
            inner: { ...fakeLayout, name: 'inner', parentLayout: 'root', vars: innerVars },
          },
        })
        assert.strictEqual(pd.vars['defaultStyle'], enabled)
        assert.deepEqual(pd.styles, enabled ? ['/default.css'] : [])
        assert.deepEqual(pd.scripts, enabled ? ['/default.js'] : [])
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('unions page and layout data dependencies outside resolved vars', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'domstack-pagedata-dependencies-test-'))
    const mdFile = join(dir, 'test.md')
    const pageVarsFile = join(dir, 'page.vars.js')

    try {
      await writeFile(mdFile, '---\ndataDeps: [feedItems]\n---\n# Test\n')
      await writeFile(pageVarsFile, 'export default { dataDeps: [\'recentPosts\'] }\n')

      const layout = {
        ...fakeLayout,
        vars: { dataDeps: ['navigation'] },
      }
      /** @type {PageData<TestVars, string, string>} */
      const pd = new PageData({
        pageInfo: {
          ...mdPageInfo(mdFile),
          pageVars: {
            root: dir,
            filepath: pageVarsFile,
            relname: 'blog/post/page.vars.js',
            basename: 'page.vars.js',
            parentName: 'blog/post',
          },
        },
        globalVars: { layout: 'default' },
        globalStyle: undefined,
        globalClient: undefined,
        defaultStyle: null,
        defaultClient: null,
        builderOptions,
      })

      await pd.init({ layouts: { default: layout } })
      await assert.rejects(pd.renderInnerPage(), /Global data is not available/)
      await assert.rejects(pd.renderFullPage(), /Global data is not available/)
      pd.setGlobalData({
        feedItems: ['Feed'],
        navigation: ['Home'],
        recentPosts: ['Recent'],
      })

      assert.deepEqual(pd.dataDeps, ['feedItems', 'navigation', 'recentPosts'])
      assert.deepEqual(Object.keys(pd.data), ['feedItems', 'recentPosts'])
      assert.throws(() => pd.data['navigation'], /undeclared global data key "navigation"/)
      assert.equal('dataDeps' in pd.vars, false)
      assert.deepEqual(pd.layoutVars, [{ name: 'default', vars: {} }])
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
