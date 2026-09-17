/**
 * @import { TestContext } from 'node:test'
 * @import { Results } from '../../lib/builder.js'
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import pino from 'pino'
import { DomStack } from '../../index.js'
import { builder } from '../../lib/builder.js'
import { DomStackAggregateError } from '../../lib/helpers/domstack-aggregate-error.js'
import { errorText, settle, writeFiles } from '../page-outputs/helpers.js'
import { startWatch } from '../../lib/watch/test-helpers.js'

/** @param {TestContext} t @param {Record<string, string>} files @param {boolean} [buildDrafts] */
async function setup (t, files, buildDrafts = false) {
  // index.test.js sweeps .tmp-* directories; these fixtures must survive parallel test files.
  const root = await mkdtemp(join(import.meta.dirname, '.streaming-'))
  const src = join(root, 'src')
  const dest = join(root, 'custom-output')
  const logs = /** @type {string[]} */ ([])
  const options = { static: true, domstackManifest: false, buildDrafts, logger: pino({ level: 'debug' }, { write: line => logs.push(line) }) }
  const site = new DomStack(src, dest, options)
  t.after(async () => {
    if (site.watching) await site.stopWatching()
    await rm(root, { recursive: true, force: true })
  })
  await writeFiles(src, {
    'global.vars.js': `export default { layout: 'root', title: 'Global', testRoot: ${JSON.stringify(root)}, testDest: ${JSON.stringify(dest)} }`,
    'root.layout.js': "export default ({ children }) => '<main>' + children + '</main>'",
    ...files,
  })
  return {
    src,
    dest,
    root,
    site,
    logs,
    build: () => builder(src, dest, options),
    /** @param {string} name */
    read: name => readFile(join(dest, name), 'utf8'),
  }
}

/**
 * @param {Results['pageBuildResults']} result
 * @param {string} src
 * @param {string} dest
 * @param {string} outputRelname
 * @param {string} owner
 * @param {number} index
 */
function assertReported (result, src, dest, outputRelname, owner, index) {
  assert.ok(result, 'page build results survive worker transport')
  const output = result.outputs.find(output => output.outputRelname === outputRelname)
  assert.ok(output, `${outputRelname} retains output metadata`)
  assert.equal(output.kind, 'page')
  assert.equal(output.filepath, join(dest, outputRelname))
  assert.equal(output.sourceRelname, `${owner}#${index}`)
  const report = result.report.pages.find(page => page.outputs.some(output => output.outputRelname === outputRelname))
  assert.ok(report, `${outputRelname} retains an ownership report`)
  assert.equal(report.pagesFilePath, join(src, owner))
  assert.equal(report.sourcePageFilePath, undefined)
  assert.equal(report.pageFilePath, join(dest, outputRelname))
  assert.deepEqual(report.outputs.find(record => record.outputRelname === outputRelname), output)
}

for (const [form, factoryExport] of Object.entries({
  'generator function': 'export default pages',
  'static async iterable': 'export default pages()',
  'async function returning an iterable': 'export default async () => pages()',
})) {
  test(`${form} renders and writes each page before requesting the next definition`, async t => {
    const { build, src, dest, read } = await setup(t, {
      'concrete/page.js': 'export default ({ vars }) => vars.title',
      'concrete/page.vars.js': "export default async () => ({ title: 'Initialized concrete' })",
      'global.data.js': `import assert from 'node:assert/strict'
        export default async ({ pages }) => {
          assert.equal(pages.length, 1)
          assert.equal(pages[0].pageInfo.generated, undefined)
          assert.equal(pages[0].vars.title, 'Initialized concrete')
          assert.equal(await pages[0].renderInnerPage(), 'Initialized concrete')
          return { collection: pages.map(page => page.vars.title), pageValue: 'Page data', layoutValue: 'Layout data' }
        }`,
      'generated.layout.js': `import assert from 'node:assert/strict'
        export const vars = { title: 'Layout', layoutOnly: 'Resolved layout', dataDeps: ['layoutValue'] }
        export default ({ vars, children, data }) => {
          assert.throws(() => data.pageValue, /undeclared/)
          return '<article>' + vars.title + ':' + vars.layoutOnly + ':' + data.layoutValue + ':' + children + '</article>'
        }
        export const pageOutputs = () => { throw Error('generated layout output hook must be skipped') }`,
      'stream.pages.js': `import assert from 'node:assert/strict'
        import { readFile } from 'node:fs/promises'
        import { join } from 'node:path'
        import globals from './global.vars.js'
        export const dataDeps = ['collection']
        export const pageOutputs = () => { throw Error('pages-file output hook must be skipped') }
        async function* pages (context) {
          if (context) {
            assert.deepEqual(context.data.collection, ['Initialized concrete'])
            assert.equal(context.pagesFile.pagesFile.relname, 'stream.pages.js')
            assert.throws(() => context.data.pageValue, /undeclared/)
          }
          for (const name of ['first', 'second']) {
            yield {
              outputName: name + '/index.html',
              vars: { layout: 'generated', title: name, dataDeps: ['pageValue'] },
              children: async ({ vars, data }) => {
                assert.equal(vars.layoutOnly, 'Resolved layout')
                assert.throws(() => data.layoutValue, /undeclared/)
                return data.pageValue
              },
            }
            assert.equal(await readFile(join(globals.testDest, name, 'index.html'), 'utf8'),
              '<article>' + name + ':Resolved layout:Layout data:Page data</article>')
          }
        }
        ${factoryExport}`,
    })
    await writeFiles(dest, { 'first/index.html': 'stale HTML must be replaced before the next pull' })
    const result = await build().catch(error => {
      t.diagnostic(errorText(error))
      throw error
    })
    for (const [index, name] of ['first', 'second'].entries()) {
      assert.equal(await read(`${name}/index.html`), `<article>${name}:Resolved layout:Layout data:Page data</article>`)
      assertReported(result.pageBuildResults, src, dest, `${name}/index.html`, 'stream.pages.js', index)
    }
    assert.equal(await read('concrete/index.html'), '<main>Initialized concrete</main>')
    assert.equal(result.pageBuildResults?.outputs.length, 3, 'generated hooks produce no extra files')
  })
}

test('single, array and function exports preserve defaults, empty children and nullish results', async t => {
  const { build, read } = await setup(t, {
    'nested/single.pages.js': 'export default {}',
    'array.pages.js': `export default [
      { children: undefined, vars: undefined, outputName: undefined },
      { outputName: 'null-child.html', children: null },
      { outputName: 'inline.html', children: async () => 'Inline' },
    ]`,
    'sync.pages.js': 'export default ({ vars }) => ({ children: vars.title })',
    'async.pages.js': "export default async () => [{ outputName: 'async.html', children: 'Async' }]",
    'null.pages.js': 'export default null',
    'undefined.pages.js': 'export default undefined',
    'null-function.pages.js': 'export default () => null',
    'undefined-function.pages.js': 'export default async () => undefined',
    'empty.pages.js': 'export default []',
    'empty-iterator.pages.js': 'export default async function* () {}',
  })
  const result = await build()
  const expected = {
    'nested/single/index.html': '',
    'array/index.html': '',
    'null-child.html': '',
    'inline.html': 'Inline',
    'sync/index.html': 'Global',
    'async.html': 'Async',
  }
  assert.deepEqual(result.pageBuildResults?.outputs.map(output => output.outputRelname).sort(), Object.keys(expected).sort())
  for (const [name, content] of Object.entries(expected)) assert.equal(await read(name), `<main>${content}</main>`)
})

for (const buildDrafts of [false, true]) {
  test(`draft yields retain their source indices with buildDrafts=${buildDrafts}`, async t => {
    const { build, src, dest, read } = await setup(t, {
      'drafts.pages.js': `export default async function* () {
        yield { outputName: 'draft.html', draft: true, children: 'Draft' }
        yield { outputName: 'published.html', children: 'Published' }
        yield { outputName: 'another-draft.html', draft: true, children: 'Another draft' }
        yield { outputName: 'last.html', children: 'Last' }
      }`,
    }, buildDrafts)
    const result = await build()
    assertReported(result.pageBuildResults, src, dest, 'published.html', 'drafts.pages.js', 1)
    assertReported(result.pageBuildResults, src, dest, 'last.html', 'drafts.pages.js', 3)
    assert.equal(result.pageBuildResults?.outputs.length, buildDrafts ? 4 : 2)
    for (const [name, index, content] of /** @type {[string, number, string][]} */ ([['draft.html', 0, 'Draft'], ['another-draft.html', 2, 'Another draft']])) {
      if (buildDrafts) {
        assertReported(result.pageBuildResults, src, dest, name, 'drafts.pages.js', index)
        assert.equal(await read(name), `<main>${content}</main>`)
      } else {
        await assert.rejects(stat(join(dest, name)), { code: 'ENOENT' })
      }
    }
  })
}

for (const scenario of [
  { name: 'invalid definition', operation: 'yield 42', message: /Generated page definition must be an object/ },
  { name: 'null yielded definition', operation: 'yield null', message: /Generated page definition must be an object/ },
  { name: 'invalid path', operation: "yield { outputName: '../escape.html' }", message: /must not contain "\.\." segments/ },
  { name: 'collision', operation: "yield { outputName: 'first.html', children: 'Must not overwrite' }", message: /Output path conflict/ },
  { name: 'page render', operation: "yield { outputName: 'broken.html', children: () => { throw Error('stream render failed') } }", message: /stream render failed/ },
  { name: 'layout render', operation: "yield { outputName: 'broken.html', vars: { layout: 'broken' } }", message: /stream layout failed/ },
  { name: 'vars initialization', operation: "yield { outputName: 'broken.html', vars: { dataDeps: false } }", message: /dataDeps/ },
  { name: 'data binding', operation: "yield { outputName: 'broken.html', vars: { dataDeps: ['missing'] } }", message: /missing/ },
  { name: 'factory', operation: "throw Error('stream factory failed')", message: /stream factory failed/ },
]) {
  test(`${scenario.name} failure closes the generator without pulling later pages and retains earlier reports`, async t => {
    const { build, src, dest, root, read } = await setup(t, {
      'broken.layout.js': "export default () => { throw Error('stream layout failed') }",
      'stream.pages.js': String.raw`import { appendFile } from 'node:fs/promises'
        import { join } from 'node:path'
        export default async function* ({ vars }) {
          const trace = join(vars.testRoot, 'trace.txt')
          try {
            await appendFile(trace, 'first\n')
            yield { outputName: 'first.html', vars: { title: 'Published' }, children: 'Published' }
            await appendFile(trace, 'bad\n')
            ${scenario.operation}
            await appendFile(trace, 'later\n')
            yield { outputName: 'later.html', children: 'Must not render' }
          } finally {
            await appendFile(trace, 'closed\n')
          }
        }`,
    })
    await writeFiles(dest, { 'broken.html': 'previous HTML' })
    await assert.rejects(build(), error => {
      assert.ok(error instanceof DomStackAggregateError)
      assert.match(errorText(error), scenario.message)
      assert.match(errorText(error), /stream\.pages\.js/)
      if (scenario.name === 'collision') {
        assert.deepEqual(error.errors[0].conflict, {
          outputPath: 'first.html',
          a: { type: 'page', path: 'stream.pages.js#0' },
          b: { type: 'page', path: 'stream.pages.js#1' },
        })
      }
      const results = /** @type {Results} */ (error.results)
      assertReported(results.pageBuildResults, src, dest, 'first.html', 'stream.pages.js', 0)
      assert.equal(results.pageBuildResults?.outputs.length, 1)
      assert.equal(results.pageBuildResults?.outputs[0]?.pageVars?.['title'], 'Published')
      return true
    })
    assert.equal(await readFile(join(root, 'trace.txt'), 'utf8'), 'first\nbad\nclosed\n', 'finally is awaited and no following yield is requested')
    assert.equal(await read('first.html'), '<main>Published</main>')
    assert.equal(await read('broken.html'), 'previous HTML')
    await assert.rejects(stat(join(dest, 'later.html')), { code: 'ENOENT' })
    await assert.rejects(stat(join(root, 'escape.html')), { code: 'ENOENT' })
  })
}

test('sibling factories publish unique outputs with independent owner metadata', async t => {
  const { build, src, dest, read } = await setup(t, Object.fromEntries(['a', 'b'].map(name => [
    `${name}.pages.js`,
    `export default async function* () {
      yield { outputName: '${name}/one.html', children: '${name} one' }
      yield { outputName: '${name}/two.html', children: '${name} two' }
    }`,
  ])))
  const result = await build()
  assert.equal(result.pageBuildResults?.outputs.length, 4)
  for (const owner of ['a', 'b']) {
    for (const [index, name] of ['one', 'two'].entries()) {
      const output = `${owner}/${name}.html`
      assert.equal(await read(output), `<main>${owner} ${name}</main>`)
      assertReported(result.pageBuildResults, src, dest, output, `${owner}.pages.js`, index)
    }
  }
})

/** @param {string[]} names @param {string} [failure] */
function watchFactory (names, failure) {
  return `export default async function* () {
    ${names.map(name => `yield { outputName: '${name}.html', children: '${name}' }`).join('\n')}
    ${failure ? `throw Error('${failure}')` : ''}
  }`
}

for (const change of ['recovery', 'deletion', 'empty result']) {
  test(`watch ${change} cleans successful and repeated partial factory ownership`, { timeout: 30_000 }, async t => {
    const { site, src, dest, read, logs } = await setup(t, {
      'stream.pages.js': watchFactory(['old', 'stale']),
      'sibling.pages.js': watchFactory(['sibling']),
    })
    await startWatch(t, site, src)
    const sibling = await read('sibling.html')
    for (const name of ['partial', 'second-partial']) {
      await settle(site, logs, async () => {
        await writeFile(join(src, 'stream.pages.js'), watchFactory([name], `${name} failure`))
      }, `${name} failure`)
      assert.equal(await read(`${name}.html`), `<main>${name}</main>`)
      assert.equal(await read('old.html'), '<main>old</main>')
      assert.equal(await read('stale.html'), '<main>stale</main>')
      assert.equal(await read('partial.html'), '<main>partial</main>', 'repeated failure keeps earlier partial ownership')
    }
    await settle(site, logs, async () => {
      if (change === 'deletion') await rm(join(src, 'stream.pages.js'))
      else await writeFile(join(src, 'stream.pages.js'), change === 'empty result' ? 'export default null' : watchFactory(['recovered']))
    })
    for (const name of ['old', 'stale', 'partial', 'second-partial']) {
      await assert.rejects(stat(join(dest, `${name}.html`)), { code: 'ENOENT' })
    }
    if (change === 'recovery') assert.equal(await read('recovered.html'), '<main>recovered</main>')
    assert.equal(await read('sibling.html'), sibling, 'cleanup preserves sibling factory output')
    await assert.rejects(stat(join(dest, 'domstack-manifest.json')), { code: 'ENOENT' })
  })
}

for (const change of ['recovery', 'deletion', 'empty result']) {
  test(`initial failed watch retains partial generated page reports for ${change}`, { timeout: 30_000 }, async t => {
    const { site, src, dest, read, logs } = await setup(t, {
      'stream.pages.js': watchFactory(['partial', 'nested/partial'], 'initial stream failure'),
    })
    const result = await startWatch(t, site, src)
    assert.ok(logs.some(line => JSON.parse(line).msg === 'Build Failed!'))
    assert.ok(logs.some(line => line.includes('initial stream failure')))
    for (const [index, name] of ['partial', 'nested/partial'].entries()) {
      assert.equal(await read(`${name}.html`), `<main>${name}</main>`)
      assertReported(result.pageBuildResults, src, dest, `${name}.html`, 'stream.pages.js', index)
    }
    await settle(site, logs, async () => {
      if (change === 'deletion') await rm(join(src, 'stream.pages.js'))
      else await writeFile(join(src, 'stream.pages.js'), change === 'empty result' ? 'export default []' : watchFactory(['recovered']))
    })
    for (const name of ['partial', 'nested/partial']) {
      await assert.rejects(stat(join(dest, `${name}.html`)), { code: 'ENOENT' })
    }
    if (change === 'recovery') assert.equal(await read('recovered.html'), '<main>recovered</main>')
  })
}
