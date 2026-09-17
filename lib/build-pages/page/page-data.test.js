/**
 * @import { PageInfo } from '../../identify-pages.js'
 * @import { ResolvedLayout } from '../layouts/resolve-layout.js'
 * @import { BuilderOptions } from '../outputs/page-writer.js'
 */

import { test } from 'node:test'
import assert from 'node:assert'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { PageData } from './page-data.js'

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

test('PageData.sourceId is a read-only normalized source-relative identity, not an output path', () => {
  /** @param {string} root @param {string} relname */
  const createPage = (root, relname) => new PageData({
    pageInfo: {
      ...mdPageInfo(join(root, relname)),
      pageFile: { ...mdPageInfo(join(root, relname)).pageFile, root, relname },
    },
    globalVars: {},
    globalStyle: undefined,
    globalClient: undefined,
    defaultStyle: null,
    defaultClient: null,
    builderOptions,
  })
  const relname = ['.', 'docs', 'topic', '..', 'README.md'].join(sep)
  const original = createPage(join(tmpdir(), 'checkout-one'), relname)
  const relocated = createPage(join(tmpdir(), 'checkout-two'), relname)
  assert.equal(original.sourceId, 'docs/README.md')
  assert.equal(relocated.sourceId, original.sourceId)
  assert.notEqual(original.pageInfo.pageFile.filepath, relocated.pageInfo.pageFile.filepath)
  assert.equal(original.pageInfo.pageFile.relname, relname, 'reading the ID does not mutate discovery metadata')
  assert.equal(Reflect.set(original, 'sourceId', 'override'), false)
  assert.equal(original.sourceId, 'docs/README.md')
  assert.equal(createPage(tmpdir(), 'README.md').sourceId, 'README.md')
  assert.equal(createPage(tmpdir(), join('first', 'page.md')).sourceId, 'first/page.md')
  assert.equal(createPage(tmpdir(), join('second', 'page.md')).sourceId, 'second/page.md')
  assert.equal(createPage(tmpdir(), join('docs', 'articles.pages.js#1')).sourceId, 'docs/articles.pages.js#1')
})

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

      pd.layoutVars[0] = { name: 'replacement', vars: { fromLayout: 'replacement entry' } }
      const replacedEntryVars = pd.vars
      assert.notStrictEqual(replacedEntryVars, removedVars, 'replacing an array entry should invalidate the cache')
      assert.strictEqual(replacedEntryVars.fromLayout, 'replacement entry')

      pd.layoutVars = pd.layoutVars.map(layer => ({ ...layer }))
      assert.strictEqual(pd.vars, replacedEntryVars, 'only vars identities matter, not the array or wrapper identities')

      pd.layoutVars = []
      assert.strictEqual(pd.vars.fromLayout, undefined, 'removing all layers should drop their values')
      assert.strictEqual(pd.vars.title, 'Test')

      for (const key of /** @type {const} */ (['globalVars', 'pageVars', 'builderVars'])) {
        const previous = pd.vars
        pd[key] = { ...pd[key], fromSource: key }
        const updated = pd.vars
        assert.notStrictEqual(updated, previous, `replacing ${key} should invalidate the cache`)
        assert.strictEqual(updated['fromSource'], key)
        assert.strictEqual(pd.vars, updated)
        assert.strictEqual(Object.isFrozen(updated), true)
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('merges separately at init and first access without mapping layouts or rereading vars on cache hits', async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'domstack-pagedata-vars-work-test-'))
    t.after(() => rm(dir, { recursive: true, force: true }))
    const mdFile = join(dir, 'test.md')
    await writeFile(mdFile, '# Test\n')

    let enumerations = 0
    let reads = 0
    const globalVars = new Proxy({
      layout: 'default',
      get defaultStyle () {
        reads++
        return true
      },
    }, {
      ownKeys (target) {
        enumerations++
        return Reflect.ownKeys(target)
      },
    })
    /** @type {PageData<TestVars, string, string>} */
    const pd = new PageData({
      pageInfo: mdPageInfo(mdFile),
      globalVars,
      globalStyle: undefined,
      globalClient: undefined,
      defaultStyle: 'default.css',
      defaultClient: 'default.js',
      builderOptions,
    })
    await pd.init({ layouts: { default: fakeLayout } })
    assert.strictEqual(enumerations, 1)
    assert.strictEqual(reads, 1)
    assert.deepStrictEqual(pd.styles, ['/default.css'])
    assert.deepStrictEqual(pd.scripts, ['/default.js'])

    const vars = pd.vars
    assert.strictEqual(enumerations, 2, 'first access takes a fresh snapshot after initialization')
    assert.strictEqual(reads, 2)
    const map = t.mock.fn(pd.layoutVars.map)
    pd.layoutVars.map = map
    for (let index = 0; index < 100; index++) assert.strictEqual(pd.vars, vars)
    await pd.init({ layouts: { default: fakeLayout } })
    assert.strictEqual(map.mock.callCount(), 0, 'cache hits must not map layout sources')
    assert.strictEqual(enumerations, 2, 'cache hits and repeated init do not merge again')
    assert.strictEqual(reads, 2)

    pd.pageVars = { fromPage: 'new source' }
    const updated = pd.vars
    assert.notStrictEqual(updated, vars)
    assert.strictEqual(updated['fromPage'], 'new source')
    assert.strictEqual(pd.vars, updated)
    assert.strictEqual(enumerations, 3, 'an invalidation merges each source just once')
    assert.strictEqual(reads, 3)
  })

  test('observes in-place source updates and getter changes between init and first vars access', async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'domstack-pagedata-vars-snapshot-test-'))
    t.after(() => rm(dir, { recursive: true, force: true }))
    const mdFile = join(dir, 'test.md')
    await writeFile(mdFile, '# Test\n')

    let getterValue = 'during init'
    let reads = 0
    const globalVars = {
      layout: 'default',
      fromGlobal: 'during init',
      get dynamic () {
        reads++
        return getterValue
      },
    }
    /** @type {PageData<TestVars, string, string>} */
    const pd = new PageData({
      pageInfo: mdPageInfo(mdFile),
      globalVars,
      globalStyle: undefined,
      globalClient: undefined,
      defaultStyle: null,
      defaultClient: null,
      builderOptions,
    })
    await pd.init({ layouts: { default: fakeLayout } })
    assert.strictEqual(reads, 1)

    globalVars.fromGlobal = 'before first access'
    getterValue = 'before first access'
    assert.strictEqual(pd.globalVars, globalVars, 'source identity has not changed')
    const vars = pd.vars
    assert.strictEqual(vars.fromGlobal, 'before first access')
    assert.strictEqual(vars['dynamic'], 'before first access')
    assert.strictEqual(reads, 2, 'first access must evaluate the getter again')
    assert.strictEqual(Object.isFrozen(vars), true)

    globalVars.fromGlobal = 'after first access'
    getterValue = 'after first access'
    assert.strictEqual(pd.vars, vars)
    assert.strictEqual(pd.vars.fromGlobal, 'before first access')
    assert.strictEqual(pd.vars['dynamic'], 'before first access')
    assert.strictEqual(reads, 2, 'later reads use the snapshot established by first access')
  })

  test('merges like object spread, including symbols, accessors and own __proto__ properties', async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'domstack-pagedata-vars-spread-test-'))
    t.after(() => rm(dir, { recursive: true, force: true }))
    const mdFile = join(dir, 'test.md')
    await writeFile(mdFile, '# Test\n')
    /** @type {PageData<TestVars, string, string>} */
    const pd = new PageData({
      pageInfo: mdPageInfo(mdFile),
      globalVars: { layout: 'default' },
      globalStyle: undefined,
      globalClient: undefined,
      defaultStyle: null,
      defaultClient: null,
      builderOptions,
    })
    await pd.init({ layouts: { default: fakeLayout } })

    const symbol = Symbol('enumerable')
    const hiddenSymbol = Symbol('hidden')
    const nested = { value: 'original' }
    const prototypeValue = { notThePrototype: true }
    /** @type {string[]} */
    const reads = []
    /** @param {string} name */
    const source = (name) => Object.defineProperties(Object.create({ inherited: 'not copied' }), {
      [name]: { enumerable: true, value: name },
      shared: { enumerable: true, get () { reads.push(name); return name } },
      [symbol]: { enumerable: true, value: name },
      [hiddenSymbol]: { value: 'not copied' },
      hidden: { get () { throw new Error('non-enumerable getters must not run') } },
      ['__proto__']: { enumerable: true, value: name },
    })
    pd.globalVars = source('global')
    const outerVars = source('outer')
    const innerVars = source('inner')
    pd.layoutVars = [
      { name: 'outer', vars: outerVars },
      { name: 'inner', vars: innerVars },
    ]
    pd.pageVars = source('page')
    pd.builderVars = { ...source('builder'), nested, ['__proto__']: prototypeValue }
    reads.length = 0

    const expected = Object.freeze({
      ...pd.globalVars,
      ...outerVars,
      ...innerVars,
      ...pd.pageVars,
      ...pd.builderVars,
    })
    const expectedReads = [...reads]
    reads.length = 0
    const vars = pd.vars
    assert.deepStrictEqual(vars, expected)
    assert.deepStrictEqual(Reflect.ownKeys(vars), Reflect.ownKeys(expected), 'preserve property order')
    assert.deepStrictEqual(Object.getOwnPropertyDescriptors(vars), Object.getOwnPropertyDescriptors(expected))
    assert.deepStrictEqual(reads, expectedReads, 'read enumerable getters once in cascade order')
    assert.strictEqual(Object.getPrototypeOf(vars), Object.prototype)
    assert.strictEqual(Object.hasOwn(vars, '__proto__'), true)
    assert.strictEqual(Reflect.get(vars, '__proto__'), prototypeValue)
    assert.strictEqual(Reflect.get(vars, symbol), 'builder')
    assert.strictEqual(Object.hasOwn(vars, hiddenSymbol), false)
    assert.strictEqual(Object.hasOwn(vars, 'inherited'), false)
    assert.strictEqual(Object.hasOwn(vars, 'hidden'), false)
    assert.strictEqual(Object.isFrozen(vars), true)
    assert.strictEqual(vars['nested'], nested)
    assert.strictEqual(Object.isFrozen(nested), false, 'freezing remains shallow')
    nested.value = 'changed'
    assert.ok(pd.builderVars)
    pd.builderVars['added'] = 'not visible until source replacement'
    assert.strictEqual(pd.vars, vars, 'in-place source mutations do not invalidate an identity cache')
    assert.strictEqual(vars['added'], undefined)
    assert.strictEqual(Reflect.get(vars['nested'], 'value'), 'changed')
    assert.deepStrictEqual(reads, expectedReads, 'cache hits do not re-read getters')

    pd.pageVars = null
    pd.builderVars = null
    assert.deepStrictEqual(pd.vars, Object.freeze({ ...pd.globalVars, ...outerVars, ...innerVars }))
  })

  test('keeps init errors unwrapped and contextualizes failed cache rebuilds without caching them', async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'domstack-pagedata-vars-errors-test-'))
    t.after(() => rm(dir, { recursive: true, force: true }))
    const mdFile = join(dir, 'test.md')
    await writeFile(mdFile, '# Test\n')
    const cause = new Error('vars getter failed')
    const brokenVars = { layout: 'default', get broken () { throw cause } }
    /**
     * @param {Partial<TestVars>} globalVars
     * @returns {PageData<TestVars, string, string>}
     */
    const createPage = (globalVars) => new PageData({
      pageInfo: mdPageInfo(mdFile),
      globalVars,
      globalStyle: undefined,
      globalClient: undefined,
      defaultStyle: null,
      defaultClient: null,
      builderOptions,
    })
    const failed = createPage(brokenVars)
    await assert.rejects(failed.init({ layouts: { default: fakeLayout } }), err => err === cause)
    assert.throws(() => failed.vars, /Initialize PageData before accessing vars for page "blog\/post"/)

    const globalVars = { layout: 'default' }
    const pd = createPage(globalVars)
    await pd.init({ layouts: { default: fakeLayout } })
    const cached = pd.vars
    pd.globalVars = brokenVars
    for (let attempt = 0; attempt < 2; attempt++) {
      assert.throws(() => pd.vars, {
        message: 'Failed to resolve vars for page "blog/post": vars getter failed',
        cause,
      })
    }
    pd.globalVars = globalVars
    assert.strictEqual(pd.vars, cached, 'failed merges do not replace a valid cache or its source identities')
    pd.globalVars = { layout: 'default', recovered: true }
    assert.strictEqual(pd.vars['recovered'], true)
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
