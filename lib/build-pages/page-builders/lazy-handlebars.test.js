/**
 * @import { TestContext } from 'node:test'
 * @import { PageInfo } from '../../identify-pages.js'
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { htmlBuilder } from './html/index.js'
import { mdBuilder } from './md/index.js'
import { getMd, renderMd } from './md/get-md.js'

/** @param {TestContext} t @param {'md' | 'html'} type @param {string} source */
async function fixture (t, type, source) {
  const root = await mkdtemp(join(tmpdir(), 'domstack-lazy-handlebars-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const basename = `page.${type}`
  /** @type {PageInfo} */
  const pageInfo = {
    pageFile: { root, filepath: join(root, basename), relname: basename, basename, parentName: '' },
    type,
    path: '',
    url: '/',
    outputName: 'index.html',
    outputRelname: 'index.html',
    draft: false,
  }
  await writeFile(pageInfo.pageFile.filepath, source)
  const builder = type === 'md' ? mdBuilder : htmlBuilder
  const built = await builder({ pageInfo })
  return {
    pageInfo,
    built,
    /** @param {Record<string, unknown>} [vars] */
    render: async (vars = {}) => await built.pageLayout({ vars, data: {}, page: pageInfo }),
  }
}

for (const type of /** @type {const} */ (['md', 'html'])) {
  /** @param {string} text */
  const expected = text => type === 'md' ? `<p>${text}</p>\n` : text

  test(`${type} checks Handlebars each render and compiles captured source with live vars`, async t => {
    const source = '{{vars.title}}'
    const { pageInfo, render } = await fixture(t, type, source)
    const { default: Handlebars } = await import('handlebars')
    const compile = t.mock.method(Handlebars, 'compile')
    await writeFile(pageInfo.pageFile.filepath, 'Changed on disk')
    assert.equal(await render(), expected(source))
    for (const handlebars of [false, null, 0, '']) {
      assert.equal(await render({ handlebars, title: 'Ignored' }), expected(source))
    }
    assert.equal(compile.mock.callCount(), 0)

    const vars = { handlebars: true, title: 'First' }
    assert.equal(await render(vars), expected('First'))
    vars.title = 'Second'
    assert.equal(await render(vars), expected('Second'))
    vars.handlebars = false
    assert.equal(await render(vars), expected(source))
    assert.equal(compile.mock.callCount(), 2)
    assert.equal(await render({ handlebars: 'enabled', title: 'Third' }), expected('Third'))
    assert.equal(compile.mock.callCount(), 3)
    for (const call of compile.mock.calls) {
      assert.equal(call.arguments[0], source)
    }
  })

  test(`${type} interpolates vars and runs helpers synchronously before returning its promise`, async t => {
    const { default: Handlebars } = await import('handlebars')
    const helper = 'domstackSynchronousHandlebarsTest'
    t.after(() => Handlebars.unregisterHelper(helper))
    /** @type {string[]} */
    const calls = []
    Handlebars.registerHelper(helper, value => {
      calls.push(`Initial ${value}`)
      return `Initial ${value}`
    })
    const source = `{{vars.title}} {{vars.nested.value}} {{${helper} vars.nested.value}}`
    const { pageInfo, built } = await fixture(t, type, source)
    const md = type === 'md' ? await getMd() : undefined
    // Exercise renderMd directly, then the warmed Markdown builder on the next call.
    if (type === 'md') await built.pageLayout({ vars: {}, data: {}, page: pageInfo })
    const vars = { handlebars: true, title: 'Before', nested: { value: 'Original' } }
    const context = { vars, data: {}, page: pageInfo }
    const pending = type === 'md'
      ? renderMd(source, context, md)
      : built.pageLayout(context)
    vars.title = 'After'
    vars.nested.value = 'Mutated'
    Handlebars.registerHelper(helper, value => {
      calls.push(`Updated ${value}`)
      return `Updated ${value}`
    })
    assert.deepEqual(calls, ['Initial Original'], 'helper side effects happen before awaiting')
    assert.equal(await pending, expected('Before Original Initial Original'))

    const next = built.pageLayout(context)
    vars.title = 'Later'
    vars.nested.value = 'Later'
    assert.deepEqual(calls, ['Initial Original', 'Updated Mutated'])
    assert.equal(await next, expected('After Mutated Updated Mutated'))
  })

  test(`${type} malformed Handlebars fails only on enabled renders`, async t => {
    const source = '{{#if vars.title}}broken'
    const { render } = await fixture(t, type, source)
    assert.equal(await render(), expected(source))
    await assert.rejects(render({ handlebars: true, title: 'Example' }), /Parse error/)
    assert.equal(await render({ handlebars: false }), expected(source))
    await assert.rejects(render({ handlebars: true }), /Parse error/)
  })
}

test('Markdown resolves its render method after the Handlebars flag but before interpolation', async t => {
  const { default: Handlebars } = await import('handlebars')
  const helper = 'domstackRenderOrderTest'
  t.after(() => Handlebars.unregisterHelper(helper))
  const md = await getMd()
  const render = md.render
  /** @type {string[]} */
  const calls = []
  Object.defineProperty(md, 'render', {
    get () {
      calls.push('renderer')
      return render
    },
  })
  Handlebars.registerHelper(helper, () => {
    calls.push('helper')
    return 'Rendered'
  })
  const context = {
    vars: {
      get handlebars () {
        calls.push('flag')
        return true
      },
    },
  }
  const pending = renderMd(`{{${helper}}}`, context, md)
  assert.deepEqual(calls, ['flag', 'renderer', 'helper'])
  assert.equal(await pending, '<p>Rendered</p>\n')
})

test('Markdown and HTML load no Handlebars modules until enabled in a fresh process', async t => {
  const pages = await Promise.all(['md', 'html'].map(type => fixture(t, /** @type {'md' | 'html'} */ (type), '{{vars.title}}')))
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `
    import assert from 'node:assert/strict'
    import { createRequire } from 'node:module'
    import { dirname, sep } from 'node:path'
    const require = createRequire(import.meta.url)
    const handlebarsRoot = dirname(require.resolve('handlebars/package.json')) + sep
    const loaded = () => Object.keys(require.cache).filter(path => path.startsWith(handlebarsRoot))
    assert.deepEqual(loaded(), [])
    const { htmlBuilder } = await import('./html/index.js')
    const { mdBuilder } = await import('./md/index.js')
    const { getMd, renderMd } = await import('./md/get-md.js')
    assert.deepEqual(loaded(), [], 'importing builders must not load Handlebars')
    const md = await getMd()
    await renderMd('Plain Markdown', {}, md)
    assert.deepEqual(loaded(), [], 'default Markdown setup and rendering must not load Handlebars')
    const prepared = []
    for (const pageInfo of ${JSON.stringify(pages.map(page => page.pageInfo))}) {
      const builder = pageInfo.type === 'md' ? mdBuilder : htmlBuilder
      const built = await builder({ pageInfo })
      assert.deepEqual(loaded(), [], pageInfo.type + ' preparation must not load Handlebars')
      const context = { vars: { handlebars: false, title: 'Enabled' }, data: {}, page: pageInfo }
      assert.match(await built.pageLayout(context), /{{vars.title}}/)
      assert.deepEqual(loaded(), [], pageInfo.type + ' disabled rendering must not load Handlebars')
      prepared.push({ built, context })
    }
    // Both builders must pass the cold checks before either can load the shared module.
    for (const { built, context } of prepared) {
      context.vars.handlebars = true
      assert.match(await built.pageLayout(context), /Enabled/)
      assert.ok(loaded().includes(require.resolve('handlebars')))
    }
  `], { cwd: import.meta.dirname, encoding: 'utf8', timeout: 15000 })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
