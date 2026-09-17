/**
 * @import { TestContext } from 'node:test'
 * @import { PageInfo } from '../../identify-pages.js'
 * @import { ResolvedLayout } from '../layouts/resolve-layout.js'
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PageData } from './page-data.js'
import { pageBuilders } from '../page-builders/index.js'

/** @type {Record<string, ResolvedLayout<any, any, any, any>>} */
const layouts = { root: { name: 'root', vars: {}, render: ({ children }) => children, layoutStylePath: null, layoutClientPath: null } }

/** @param {TestContext} t @param {PageInfo['type']} type @param {string} content */
async function fixture (t, type, content) {
  const dir = await mkdtemp(join(tmpdir(), 'domstack-renderer-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const name = `page.${type === 'js' ? 'mjs' : type}`
  const filepath = join(dir, name)
  await writeFile(filepath, content)
  /** @type {PageInfo} */
  const pageInfo = {
    pageFile: { root: dir, filepath, relname: name, basename: name, parentName: '' },
    type,
    path: '',
    url: '/',
    outputName: 'index.html',
    outputRelname: 'index.html',
    draft: false,
  }
  const createPage = () => new PageData({
    pageInfo,
    globalVars: { layout: 'root', handlebars: true, value: 'initial' },
    globalStyle: undefined,
    globalClient: undefined,
    defaultStyle: null,
    defaultClient: null,
    builderOptions: {},
  })
  return { page: createPage(), createPage, filepath }
}

for (const type of /** @type {const} */ (['html', 'md'])) {
  test(`${type} prepares once, captures source, and still receives live render inputs`, async t => {
    const { page, createPage, filepath } = await fixture(t, type, 'Original {{ vars.value }}')
    const builder = t.mock.method(pageBuilders, type)
    await assert.rejects(page.renderInnerPage(), /initialized/)
    await page.init({ layouts })
    await page.init({ layouts })
    assert.equal(builder.mock.callCount(), 1)
    page.globalVars['value'] = 'before first access'
    await writeFile(filepath, 'Changed {{ vars.value }}')
    assert.match(await page.renderInnerPage(), /Original before first access/)
    page.globalVars = { ...page.globalVars, value: 'replacement' }
    assert.match(await page.renderFullPage(), /Original replacement/)
    assert.equal(builder.mock.callCount(), 1, 'rendering does not repeat builder preparation')
    if (type === 'md') assert.equal(await page.readMarkdownContent(), 'Changed {{ vars.value }}', 'raw-content reads remain independent')
    const fresh = createPage()
    await fresh.init({ layouts })
    assert.match(await fresh.renderInnerPage(), /Changed initial/)
    assert.equal(builder.mock.callCount(), 2)
  })
}

test('prepared JS functions rerun with current data and assets, without rebinding this or invoking hooks', async t => {
  const { page, filepath } = await fixture(t, 'js', `
    export const vars = { dataDeps: ['selected'] }
    export let calls = 0
    export let hookCalls = 0
    export default function ({ vars, data, styles, scripts, workers }) {
      if (this !== undefined) throw new Error('renderer must not be bound to PageData')
      return JSON.stringify({ calls: ++calls, value: vars.value, selected: data.selected, styles, scripts, workers })
    }
    export function pageOutputs () { hookCalls++; return [] }
  `)
  const builder = t.mock.method(pageBuilders, 'js')
  await page.init({ layouts })
  await assert.rejects(page.renderInnerPage(), /Global data is not available/)
  page.setGlobalData({ selected: 'first' })
  assert.equal(JSON.parse(await page.renderInnerPage()).selected, 'first')
  page.setGlobalData({ selected: 'second' })
  page.styles = ['/new.css']
  page.scripts = ['/new.js']
  page.workerFiles = { search: '/search.js' }
  page.globalVars = { ...page.globalVars, value: 'new vars' }
  assert.deepEqual(JSON.parse(await page.renderInnerPage()), {
    calls: 2, value: 'new vars', selected: 'second', styles: ['/new.css'], scripts: ['/new.js'], workers: { search: '/search.js' },
  })
  assert.equal(builder.mock.callCount(), 1)
  const module = await import(filepath)
  assert.equal(module.hookCalls, 0)
  await Array.fromAsync(page.collectPageOutputs())
  assert.equal(module.hookCalls, 1)
})

test('generated renderers are prepared once without caching their results', async t => {
  const { page } = await fixture(t, 'js', "throw new Error('generated pages must not import source')")
  let calls = 0
  page.pageInfo.generated = {
    pagesFile: { pagesFile: page.pageInfo.pageFile, path: '', name: 'generated' },
    children: () => `render ${++calls}`,
  }
  const builder = t.mock.method(pageBuilders, 'js')
  await page.init({ layouts })
  assert.equal(await page.renderInnerPage(), 'render 1')
  page.pageInfo.generated.children = 'replacement'
  assert.equal(await page.renderFullPage(), 'render 2')
  assert.equal(builder.mock.callCount(), 1)
})

test('generated static children are captured at initialization', async t => {
  const { page } = await fixture(t, 'js', "throw new Error('generated pages must not import source')")
  page.pageInfo.generated = {
    pagesFile: { pagesFile: page.pageInfo.pageFile, path: '', name: 'generated' },
    children: 'original',
  }
  await page.init({ layouts })
  page.pageInfo.generated.children = 'replacement'
  assert.equal(await page.renderInnerPage(), 'original')
})

test('JS default export selection is fixed at initialization', async t => {
  const { page, filepath } = await fixture(t, 'js', `
    let render = () => 'original'
    export { render as default }
    export function replace () { render = () => 'replacement' }
  `)
  await page.init({ layouts })
  const module = await import(filepath)
  module.replace()
  assert.equal(module.default(), 'replacement')
  assert.equal(await page.renderInnerPage(), 'original')
})

test('failed initialization cannot expose a prepared renderer and can retry preparation', async t => {
  const { page, filepath } = await fixture(t, 'html', 'Original')
  await assert.rejects(page.init({ layouts: {} }), /layout/i)
  await assert.rejects(page.renderInnerPage(), /initialized/)
  await writeFile(filepath, 'Recovered')
  await page.init({ layouts })
  assert.equal(await page.renderInnerPage(), 'Recovered')
})
