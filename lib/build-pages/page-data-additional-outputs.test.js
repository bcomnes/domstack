/**
 * @import { PageInfo } from '../identify-pages.js'
 * @import { ResolvedLayout } from './page-data.js'
 * @import { TestContext } from 'node:test'
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PageData, resolveLayout } from './page-data.js'
import { identifyPages } from '../identify-pages.js'

/**
 * @param {TestContext} t
 * @param {{ module?: string, companion?: string, extension?: string }} [options]
 */
async function fixture (t, { module, companion, extension = 'mjs' } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'domstack-hooks-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const filepath = join(dir, module ? `page.${extension}` : 'page.md')
  await writeFile(filepath, module ?? '---\ntitle: Source\n---\n# Body\n')
  const file = (/** @type {string} */ path) => ({ root: dir, filepath: join(dir, path), relname: path, basename: path, parentName: '' })
  /** @type {PageInfo} */
  const pageInfo = {
    pageFile: file(module ? `page.${extension}` : 'page.md'),
    type: module ? 'js' : 'md',
    path: '',
    url: '/',
    outputName: 'index.html',
    outputRelname: 'index.html',
    draft: false,
  }
  if (companion !== undefined) {
    await writeFile(join(dir, 'page.vars.mjs'), companion)
    pageInfo.pageVars = file('page.vars.mjs')
  }
  const pd = new PageData({ pageInfo, globalVars: { layout: 'inner', additionalOutputs: () => { throw new Error('global vars are not providers') } }, globalStyle: undefined, globalClient: undefined, defaultStyle: null, defaultClient: null, builderOptions: {} })
  /** @type {Record<string, ResolvedLayout<any, any, any, any>>} */
  const layouts = {
    outer: { name: 'outer', render: ({ children }) => children, vars: {}, layoutStylePath: null, layoutClientPath: null },
    inner: { name: 'inner', parentLayout: 'outer', render: ({ children }) => children, vars: {}, layoutStylePath: null, layoutClientPath: null },
  }
  return { pd, layouts, dir }
}

test('explicit collection runs outer -> inner -> page with renderer subscriptions, not on rendering', async t => {
  const { pd, layouts, dir } = await fixture(t, {
    module: `export const vars = { dataDeps: ['pageKey'] }
      export let hookCalls = 0
      export default ({ data }) => data.pageKey
      export const additionalOutputs = ({ page, vars, data }) => {
        hookCalls++
        return { outputName: 'page.txt', content: data.pageKey + data.companionKey + page.url }
      }`,
    companion: "export default { dataDeps: ['companionKey'] }",
  })
  /** @type {string[]} */
  const calls = []
  for (const name of ['outer', 'inner']) {
    const path = join(dir, `${name}.layout.mjs`)
    await writeFile(path, `export const vars = { dataDeps: ['${name}Key'] }; export default ({ children }) => children;
      export const additionalOutputs = ({ data }) => ({ outputName: '${name}.txt', content: data.${name}Key });`)
    const layout = layouts[name]
    assert.ok(layout)
    const resolved = await resolveLayout(path)
    Object.assign(layout, resolved, { parentLayout: name === 'inner' ? 'outer' : undefined })
    const hook = layout.additionalOutputs
    assert.ok(hook)
    layout.additionalOutputs = params => {
      calls.push(name)
      assert.deepEqual(Object.keys(params.data), [`${name}Key`])
      assert.throws(() => params.data.pageKey, /undeclared/)
      return hook(params)
    }
  }
  await assert.rejects(Array.fromAsync(pd.collectAdditionalOutputs()), /initialized/)
  await pd.init({ layouts })
  await assert.rejects(Array.fromAsync(pd.collectAdditionalOutputs()), /outer.*not available/)
  assert.deepEqual(pd.dataDeps, ['companionKey', 'innerKey', 'outerKey', 'pageKey'])
  pd.setGlobalData({ pageKey: 'p', companionKey: 'c', outerKey: 'o', innerKey: 'i', secret: 'hidden' })
  await pd.renderInnerPage()
  await pd.renderFullPage()
  assert.deepEqual(calls, [])
  const pageModule = await import(pd.pageInfo.pageFile.filepath)
  assert.equal(pageModule.hookCalls, 0)
  const outputs = await Array.fromAsync(pd.collectAdditionalOutputs())
  assert.equal(pageModule.hookCalls, 1)
  assert.deepEqual(calls, ['outer', 'inner'])
  assert.deepEqual(outputs.map(({ outputName, content }) => ({ outputName, content })), [
    { outputName: 'outer.txt', content: 'o' }, { outputName: 'inner.txt', content: 'i' }, { outputName: 'page.txt', content: 'pc/' },
  ])
  assert.deepEqual(outputs[0]?.provenance, { kind: 'layout', source: join(dir, 'outer.layout.mjs'), layoutName: 'outer' })
  assert.deepEqual(outputs[2]?.provenance, { kind: 'page', source: join(dir, 'page.mjs') })
})

test('collection invokes providers lazily in outer -> inner -> page order', async t => {
  const { pd, layouts } = await fixture(t, {
    module: `export default () => ''
      export let hookCalls = 0
      export function additionalOutputs () {
        hookCalls++
        return [{ outputName: 'page.txt', content: 'page' }]
      }`,
  })
  /** @type {string[]} */
  const events = []
  for (const name of ['outer', 'inner']) {
    const layout = layouts[name]
    assert.ok(layout)
    layout.additionalOutputs = () => {
      events.push(`${name}:called`)
      return (async function * () {
        try {
          for (const index of [1, 2]) {
            events.push(`${name}:${index}`)
            yield { outputName: `${name}-${index}.txt`, content: `${index}` }
          }
        } finally {
          events.push(`${name}:closed`)
        }
      })()
    }
  }
  await pd.init({ layouts })
  const pageModule = await import(pd.pageInfo.pageFile.filepath)
  const outputs = pd.collectAdditionalOutputs()
  assert.equal(outputs[Symbol.asyncIterator](), outputs)
  assert.deepEqual(events, [])
  assert.equal(pageModule.hookCalls, 0)
  assert.equal((await outputs.next()).value?.outputName, 'outer-1.txt')
  assert.deepEqual(events, ['outer:called', 'outer:1'])
  assert.equal((await outputs.next()).value?.outputName, 'outer-2.txt')
  assert.deepEqual(events, ['outer:called', 'outer:1', 'outer:2'])
  assert.equal(pageModule.hookCalls, 0)
  assert.equal((await outputs.next()).value?.outputName, 'inner-1.txt')
  assert.deepEqual(events, ['outer:called', 'outer:1', 'outer:2', 'outer:closed', 'inner:called', 'inner:1'])
  assert.equal((await outputs.next()).value?.outputName, 'inner-2.txt')
  assert.equal(pageModule.hookCalls, 0)
  assert.equal((await outputs.next()).value?.outputName, 'page.txt')
  assert.deepEqual(events, ['outer:called', 'outer:1', 'outer:2', 'outer:closed', 'inner:called', 'inner:1', 'inner:2', 'inner:closed'])
  assert.equal(pageModule.hookCalls, 1)
  assert.deepEqual(await outputs.next(), { value: undefined, done: true })
})

test('closing collection runs the active provider finally and never invokes later providers', async t => {
  for (const close of ['return', 'break']) {
    const { pd, layouts } = await fixture(t, {
      module: `export default () => ''
        export let hookCalls = 0
        export function additionalOutputs () { hookCalls++; return [] }`,
    })
    /** @type {string[]} */
    const events = []
    const { outer, inner } = layouts
    assert.ok(outer)
    assert.ok(inner)
    outer.additionalOutputs = () => {
      events.push('outer:called')
      return (async function * () {
        try {
          yield { outputName: 'first.txt', content: 'first' }
          events.push('outer:second')
          yield { outputName: 'second.txt', content: 'second' }
        } finally {
          await Promise.resolve()
          events.push('outer:closed')
        }
      })()
    }
    inner.vars = { dataDeps: ['unready'] }
    inner.additionalOutputs = () => { events.push('inner:called'); return [] }
    await pd.init({ layouts })
    const pageModule = await import(pd.pageInfo.pageFile.filepath)
    const unopened = pd.collectAdditionalOutputs()
    await unopened.return()
    assert.deepEqual(events, [])
    const outputs = pd.collectAdditionalOutputs()
    if (close === 'return') {
      assert.equal((await outputs.next()).value?.outputName, 'first.txt')
      assert.deepEqual(events, ['outer:called'])
      assert.deepEqual(await outputs.return(), { value: undefined, done: true })
    } else {
      // eslint-disable-next-line no-unreachable-loop -- Exercise iterator cleanup on an early break.
      for await (const output of outputs) {
        assert.equal(output.outputName, 'first.txt')
        assert.deepEqual(events, ['outer:called'])
        break
      }
    }
    assert.deepEqual(events, ['outer:called', 'outer:closed'])
    assert.equal(pageModule.hookCalls, 0)
    assert.deepEqual(await outputs.next(), { value: undefined, done: true })
  }
})

test('streamed provider errors retain page context and causes after earlier records', async t => {
  const { pd, layouts } = await fixture(t, {
    module: "export default () => ''; export const additionalOutputs = () => { throw new Error('page must not run') }",
  })
  const cause = new Error('iterator failed')
  let closed = false
  const { outer } = layouts
  assert.ok(outer)
  outer.additionalOutputs = async function * () {
    try {
      yield { outputName: 'first.txt', content: 'first' }
      throw cause
    } finally {
      closed = true
    }
  }
  await pd.init({ layouts })
  const outputs = pd.collectAdditionalOutputs()
  assert.equal((await outputs.next()).value?.outputName, 'first.txt')
  assert.equal(closed, false)
  await assert.rejects(outputs.next(), error => {
    assert.ok(error instanceof Error)
    assert.match(error.message, /additionalOutputs for page "page.mjs" from layout "outer" failed: Invalid additionalOutputs.*iterator failed/)
    assert.ok(error.cause instanceof Error)
    assert.equal(error.cause.cause, cause)
    return true
  })
  assert.equal(closed, true)
})

test('markdown companion gets a frozen narrow source handle and subscribed data', async t => {
  const { pd, layouts, dir } = await fixture(t, {
    companion: `
    import assert from 'node:assert/strict'
    export default { dataDeps: ['selected'] }
    export const dataDeps = ['secret'] // A named export is not a subscription declaration.
    export async function additionalOutputs ({ page, vars, data }) {
      assert.equal(Object.isFrozen(page), true)
      assert.equal(Object.isFrozen(page.pageFile), true)
      assert.equal(Object.isFrozen(vars), true)
      for (const key of ['data', 'pageInfo', 'renderInnerPage', 'renderFullPage', 'setGlobalData', 'collectAdditionalOutputs']) assert.equal(key in page, false)
      assert.throws(() => { page.pageFile.filepath = '/other.md' }, TypeError)
      assert.throws(() => data.secret, /undeclared/)
      const read = page.readMarkdownContent
      return { outputName: 'body.md', content: data.selected + await read.call({ pageInfo: {} }) }
    }`
  })
  await pd.init({ layouts })
  await assert.rejects(Array.fromAsync(pd.collectAdditionalOutputs()), /companion.*not available/)
  pd.setGlobalData({ selected: 'selected:', secret: 'hidden' })
  assert.deepEqual(await Array.fromAsync(pd.collectAdditionalOutputs()), [{ outputName: 'body.md', content: 'selected:\n# Body\n', provenance: { kind: 'companion', source: join(dir, 'page.vars.mjs') } }])
})

test('JS and TS page providers work and cannot read markdown or undeclared data', async t => {
  for (const extension of ['mjs', 'ts']) {
    const { pd, layouts } = await fixture(t, {
      extension, module: `
      import assert from 'node:assert/strict'
      export default () => 'page'
      export async function additionalOutputs ({ page, data }) {
        await assert.rejects(page.readMarkdownContent(), /only.*markdown/)
        assert.throws(() => data.secret, /undeclared/)
        return []
      }`
    })
    await pd.init({ layouts })
    pd.setGlobalData({ secret: 'hidden' })
    assert.deepEqual(await Array.fromAsync(pd.collectAdditionalOutputs()), [])
  }
})

test('companions also provide outputs for JS and HTML pages', async t => {
  for (const type of ['js', 'html']) {
    const { pd, layouts } = await fixture(t, {
      ...(type === 'js' ? { module: "export const vars = { dataDeps: ['selected'] }; export default () => ''" } : {}),
      companion: `export default { dataDeps: ['selected'] };
        export const additionalOutputs = async ({ data }) => [{ outputName: 'extra.txt', content: data.selected }]`,
    })
    if (type === 'html') {
      pd.pageInfo.type = 'html'
      await writeFile(pd.pageInfo.pageFile.filepath, '<p>HTML source</p>')
    }
    await pd.init({ layouts })
    pd.setGlobalData({ selected: type })
    const outputs = await Array.fromAsync(pd.collectAdditionalOutputs())
    assert.equal(outputs[0]?.content, type)
    assert.equal(outputs[0]?.provenance.kind, 'companion')
  }
})

test('conflicting page providers and invalid exports identify their sources', async t => {
  const { pd, layouts } = await fixture(t, { module: "export default () => ''; export const additionalOutputs = () => []", companion: 'export const additionalOutputs = () => []' })
  await assert.rejects(pd.init({ layouts }), /page.mjs.*page.vars.mjs.*both export additionalOutputs/)
  for (const options of [{ module: "export default () => ''; export const additionalOutputs = 1" }, { companion: 'export const additionalOutputs = null' }]) {
    const { pd, layouts } = await fixture(t, options)
    await assert.rejects(pd.init({ layouts }), /additionalOutputs.*page.*must be a function/)
  }
  const { dir } = await fixture(t)
  const path = join(dir, 'bad.layout.mjs')
  await writeFile(path, "export default () => ''; export const additionalOutputs = {}")
  await assert.rejects(resolveLayout(path), /additionalOutputs.*bad.layout.mjs.*function/)
})

test('generated pages skip page, companion and all layout hooks', async t => {
  const { pd, layouts } = await fixture(t, { module: "throw new Error('must not import source module')", companion: 'export const additionalOutputs = 123' })
  pd.pageInfo.generated = { pagesFile: { pagesFile: pd.pageInfo.pageFile, path: '', name: 'generated' }, children: 'generated' }
  for (const layout of Object.values(layouts)) {
    layout.vars = { dataDeps: ['unready'] }
    layout.additionalOutputs = () => { throw new Error('generated hook ran') }
  }
  await pd.init({ layouts })
  assert.deepEqual(await pd.collectAdditionalOutputs().next(), { value: undefined, done: true })
})

test('discovery excludes ignored providers and disabled drafts but enabled drafts collect outputs', async t => {
  const { pd, layouts, dir } = await fixture(t, {
    companion: "export const additionalOutputs = () => ({ outputName: 'draft.txt', content: 'draft output' })",
  })
  await rm(pd.pageInfo.pageFile.filepath)
  await writeFile(join(dir, 'page.draft.md'), '# Draft')
  await writeFile(join(dir, 'page.js'), "throw new Error('ignored provider must not load')")
  const disabled = await identifyPages(dir, { ignore: ['page.js'] })
  assert.equal(disabled.pages.length, 0)
  const enabled = await identifyPages(dir, { ignore: ['page.js'], buildDrafts: true })
  assert.equal(enabled.pages.length, 1)
  const [pageInfo] = enabled.pages
  assert.ok(pageInfo)
  assert.equal(pageInfo.draft, true)
  pd.pageInfo = pageInfo
  await pd.init({ layouts })
  pd.setGlobalData({})
  assert.equal((await Array.fromAsync(pd.collectAdditionalOutputs()))[0]?.content, 'draft output')
})

test('page hook failures include page and provider context, and no providers is valid', async t => {
  for (const body of ["throw new Error('hook failed')", "return 'bare string'", "return (async function * () { throw new Error('iterator failed') })()"]) {
    const { pd, layouts } = await fixture(t, { companion: `export function additionalOutputs () { ${body} }` })
    await pd.init({ layouts })
    await assert.rejects(Array.fromAsync(pd.collectAdditionalOutputs()), /additionalOutputs for page "page.md" from companion.*page.vars.mjs.*(failed|Record)/)
  }
  const { pd, layouts } = await fixture(t)
  await pd.init({ layouts })
  assert.deepEqual(await Array.fromAsync(pd.collectAdditionalOutputs()), [])
})
