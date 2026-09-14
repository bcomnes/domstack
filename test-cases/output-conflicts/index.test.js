/**
 * @import { TestContext } from 'node:test'
 * @import { DomStackOpts } from '../../lib/builder.js'
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { builder } from '../../lib/builder.js'
import { stagedCopy } from '../../lib/helpers/staged-copy.js'
import { buildPages } from '../../lib/build-pages/index.js'
import { identifyPages } from '../../lib/identify-pages.js'
import { DomStackAggregateError } from '../../lib/helpers/domstack-aggregate-error.js'
import pino from 'pino'
import { DomStack } from '../../index.js'
import { OutputRegistry, isCaseInsensitiveDest } from '../../lib/output-registry.js'

/** @param {string} root @param {Record<string, string>} files */
async function writeFiles (root, files) {
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content)
  }
}

/** @param {TestContext} t @param {Record<string, string>} files @param {DomStackOpts} [opts] */
async function setup (t, files, opts = {}) {
  const tmp = await mkdtemp(join(import.meta.dirname, 'tmp-'))
  const src = join(tmp, 'src')
  const dest = join(tmp, 'public')
  await writeFiles(src, {
    'global.vars.js': "export default { layout: 'root' }",
    'root.layout.js': 'export default ({ children }) => children',
    ...files,
  })
  const logs = /** @type {string[]} */ ([])
  const site = new DomStack(src, dest, { ...opts, logger: pino({ level: 'debug' }, { write: line => logs.push(line) }) })
  const sites = [site]
  t.after(async () => {
    for (const site of sites) if (site.watching) await site.stopWatching()
    await rm(tmp, { recursive: true, force: true })
  })
  return { src, dest, tmp, site, sites, logs }
}

/** @param {unknown} error @returns {Error & { code?: string, contextData?: { outputPath?: string } } | undefined} */
function conflict (error) {
  if (!(error instanceof Error)) return
  const value = /** @type {Error & { code?: string, errors?: unknown[], contextData?: { outputPath?: string } }} */ (error)
  if (value.code === 'DOM_STACK_ERROR_OUTPUT_CONFLICT') return value
  return conflict(value.cause) ?? value.errors?.map(conflict).find(Boolean)
}

/** @param {string} output @param {string} [content] */
const template = (output, content = 'template') => `export default () => ({ outputName: ${JSON.stringify(output)}, content: ${JSON.stringify(content)} })`

for (const scenario of [
  { name: 'regular page/template', files: { 'page.html': 'page', 'a.template.js': template('index.html') }, output: 'index.html', sources: ['page.html', 'a.template.js'] },
  { name: 'generated page/template', files: { 'a.pages.js': "export default { outputName: 'generated.html', children: 'page' }", 'b.template.js': template('generated.html') }, output: 'generated.html', sources: ['a.pages.js', 'b.template.js'] },
  { name: 'template objects', files: { 'a.template.js': template('feed.xml'), 'b.template.js': template('feed.xml') }, output: 'feed.xml', sources: ['a.template.js', 'b.template.js'] },
  { name: 'template array', files: { 'a.template.js': "export default () => [{ outputName: 'feed.xml', content: 'one' }, { outputName: 'feed.xml', content: 'two' }]" }, output: 'feed.xml', sources: ['a.template.js'] },
  { name: 'template async iterator', files: { 'a.template.js': "export default async function * () { yield { outputName: 'feed.xml', content: 'one' }; yield { outputName: 'feed.xml', content: 'two' } }" }, output: 'feed.xml', sources: ['a.template.js'] },
  { name: 'file/directory templates', files: { 'a.template.js': template('feed'), 'b.template.js': template('feed/index.xml') }, output: 'feed', sources: ['a.template.js', 'b.template.js'] },
  { name: 'static/template', files: { 'feed.xml': 'static', 'a.template.js': template('feed.xml') }, output: 'feed.xml', sources: ['feed.xml', 'a.template.js'] },

  { name: 'esbuild/template', files: { 'page.html': 'page', 'client.js': 'console.log(1)', 'esbuild.settings.js': "export default opts => ({ ...opts, entryNames: '[dir]/[name]' })", 'a.template.js': template('client.js') }, output: 'client.js', sources: ['client.js', 'a.template.js'] },
  { name: 'esbuild settings cannot bypass claims', files: { 'page.html': 'page', 'client.js': 'console.log(1)', 'esbuild.settings.js': "export default opts => ({ ...opts, entryNames: '[dir]/[name]', metafile: false, write: true })", 'a.template.js': template('client.js') }, output: 'client.js', sources: ['client.js', 'a.template.js'] },
  { name: 'service worker/template', files: { 'service-worker.js': 'console.log(1)', 'a.template.js': template('service-worker.js') }, output: 'service-worker.js', sources: ['service-worker.js', 'a.template.js'] },
  { name: 'workers.json/template', files: { 'page.html': 'page', 'test.worker.js': 'console.log(1)', 'a.template.js': template('workers.json') }, output: 'workers.json', sources: ['page.html', 'a.template.js'] },
  { name: 'metadata/template', files: { 'a.template.js': template('domstack-esbuild-meta.json') }, output: 'domstack-esbuild-meta.json', sources: ['domstack esbuild metadata', 'a.template.js'] },
  { name: 'manifest/template', files: { 'a.template.js': template('domstack-manifest.json') }, output: 'domstack-manifest.json', sources: ['generated domstack manifest', 'a.template.js'] },
  { name: 'normalized separators', files: { 'a.template.js': template('feed/index.xml'), 'b.template.js': template('feed\\index.xml') }, output: 'feed/index.xml', sources: ['a.template.js', 'b.template.js'] },
]) {
  test(`one-shot rejects ${scenario.name} without overwriting the first producer`, async t => {
    const { site, dest } = await setup(t, scenario.files, { domstackManifest: true })
    await writeFiles(dest, { 'sentinel.txt': 'last successful build' })
    await assert.rejects(site.build(), error => {
      const found = conflict(error)
      assert.ok(found, String(error))
      assert.ok(found.message.includes(scenario.output), found.message)
      for (const source of scenario.sources) assert.ok(found.message.includes(source), found.message)
      return true
    })
    assert.ok(!(await readdir(dest)).some(name => name.startsWith('.domstack-')))
    if (scenario.name === 'static/template') assert.equal(await readFile(join(dest, 'feed.xml'), 'utf8'), 'static')
    if (scenario.name.startsWith('esbuild/')) assert.match(await readFile(join(dest, 'client.js'), 'utf8'), /console.log/)
    if (scenario.name === 'manifest/template') assert.equal(await readFile(join(dest, 'domstack-manifest.json'), 'utf8'), 'template')
    if (scenario.name === 'service worker/template') assert.equal(await readFile(join(dest, 'service-worker.js'), 'utf8'), 'template')
    assert.equal(await readFile(join(dest, 'sentinel.txt'), 'utf8'), 'last successful build')
  })
}

test('copy producers are isolated before file/directory and cross-step checks', async t => {
  for (const mode of ['copy-copy', 'copy-static', 'copy-page', 'copy-esbuild']) {
    await t.test(mode, async t => {
      const { tmp, src, dest } = await setup(t, {
        ...(mode === 'copy-static' ? { feed: 'static' } : {}),
        ...(mode === 'copy-page' ? { 'feed/page.html': 'page' } : {}),
        ...(mode === 'copy-esbuild' ? { 'page.html': 'page', 'client.js': 'console.log(1)', 'esbuild.settings.js': "export default opts => ({ ...opts, entryNames: '[dir]/[name]' })" } : {}),
      })
      const a = join(tmp, 'a')
      const b = join(tmp, 'b')
      await writeFiles(a, { [mode === 'copy-static' ? 'feed/index.xml' : mode === 'copy-esbuild' ? 'client.js' : 'feed']: 'copy a' })
      await writeFiles(b, { 'feed/index.xml': 'copy b' })
      const site = new DomStack(src, dest, { copy: mode === 'copy-copy' ? [a, b] : [a] })
      await assert.rejects(site.build(), error => {
        assert.ok(conflict(error), String(error))
        return true
      })
      assert.ok(!(await readdir(dest)).some(name => name.startsWith('.domstack-')))
      if (mode === 'copy-page') assert.equal(await readFile(join(dest, 'feed'), 'utf8'), 'copy a')
    })
  }
})

test('stages are unique, do not delete lookalike user directories, and stay out of metadata', async t => {
  const { site, dest, tmp } = await setup(t, { 'page.html': 'page', 'client.js': 'console.log(1)' }, { domstackManifest: true })
  await writeFiles(`${dest}.domstack-stage`, { 'keep.txt': 'user data' })
  const [a, b] = await Promise.all([site.build(), site.build()])
  assert.equal(a.domstackManifest?.version, b.domstackManifest?.version)
  assert.equal(await readFile(join(`${dest}.domstack-stage`, 'keep.txt'), 'utf8'), 'user data')
  assert.ok(!(await readFile(join(dest, 'domstack-esbuild-meta.json'), 'utf8')).includes('.domstack-stage'))
  assert.doesNotMatch(JSON.stringify(a), /\.domstack-stage-[a-zA-Z0-9]{6}/)
  assert.ok(!(await readdir(tmp)).some(name => name.startsWith('.domstack-stage-')))
})

test('case-insensitive destination collisions follow the destination filesystem', async t => {
  const { site, dest } = await setup(t, { 'a.template.js': template('Feed.xml'), 'b.template.js': template('feed.xml') })
  if (await isCaseInsensitiveDest(dest)) await assert.rejects(site.build(), error => !!conflict(error))
  else {
    await site.build()
    assert.equal(await readFile(join(dest, 'Feed.xml'), 'utf8'), 'template')
    assert.equal(await readFile(join(dest, 'feed.xml'), 'utf8'), 'template')
  }
})

test('registry distinguishes duplicate records from duplicate writes and bounds replacement state', () => {
  const owner = { id: 'template:a', type: 'template', path: 'a.template.js' }
  let registry = new OutputRegistry([], { caseInsensitive: true })
  registry.claim('Feed\\index.xml', owner)
  assert.throws(() => registry.claim('feed/index.xml', owner), error => !!conflict(error))
  assert.throws(() => registry.claim('FEED', { ...owner, id: 'b' }), error => !!conflict(error))
  for (let i = 0; i < 100; i++) {
    registry = new OutputRegistry(registry.snapshot(), { replaceOwnerIds: [owner.id] })
    registry.claim(`feed-${i}.xml`, owner)
    assert.equal(registry.snapshot().length, 1)
  }
  const record = { filepath: '/dest/a', outputRelname: 'a', kind: /** @type {const} */ ('static'), sourceRelname: 'a' }
  registry.claimRecords([record, { ...record }])
  assert.equal(registry.snapshot().length, 2)
  for (const path of ['../bad', '/bad', 'C:\\bad', '.']) assert.throws(() => registry.claim(path, owner))
})

/** @param {() => boolean | Promise<boolean>} predicate */
async function waitFor (predicate) {
  const deadline = Date.now() + 5000
  while (!await predicate()) {
    assert.ok(Date.now() < deadline, 'Timed out waiting for the watch result')
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

/** @param {DomStack} site */
async function settle (site) {
  await new Promise(resolve => setTimeout(resolve, 850))
  await site.settled()
}

test('filtered watch conflicts retain successful outputs and recover after template renames and removals', { timeout: 30_000 }, async t => {
  const { site, src, dest, logs } = await setup(t, {
    'a.template.js': template('a.txt', 'A'),
    'b.template.js': template('b.txt', 'B'),
  })
  await site.watch({ serve: false })
  await writeFile(join(src, 'a.template.js'), template('b.txt', 'conflict'))
  await settle(site)
  assert.ok(logs.some(line => line.includes('Output path conflict')))
  assert.equal(await readFile(join(dest, 'a.txt'), 'utf8'), 'A')
  assert.equal(await readFile(join(dest, 'b.txt'), 'utf8'), 'B')
  await writeFile(join(src, 'a.template.js'), template('c.txt', 'C'))
  await settle(site)
  await assert.rejects(stat(join(dest, 'a.txt')), { code: 'ENOENT' })
  assert.equal(await readFile(join(dest, 'c.txt'), 'utf8'), 'C')
  await rename(join(src, 'a.template.js'), join(src, 'renamed.template.js'))
  await settle(site)
  assert.equal(await readFile(join(dest, 'c.txt'), 'utf8'), 'C')
  await rm(join(src, 'renamed.template.js'))
  await settle(site)
  await assert.rejects(stat(join(dest, 'c.txt')), { code: 'ENOENT' })
  await writeFile(join(src, 'b.template.js'), template('c.txt', 'reclaimed'))
  await settle(site)
  assert.equal(await readFile(join(dest, 'c.txt'), 'utf8'), 'reclaimed')
  await assert.rejects(stat(join(dest, 'b.txt')), { code: 'ENOENT' })
})

test('copy watch rejects page-owned paths and releases removed copy outputs', { timeout: 30_000 }, async t => {
  const { tmp, src, dest, logs, sites } = await setup(t, { 'page.html': 'page' })
  const copy = join(tmp, 'copy')
  await writeFiles(copy, { 'copy.txt': 'old' })
  const site = new DomStack(src, dest, { copy: [copy], logger: pino({}, { write: line => logs.push(line) }) })
  sites.push(site)
  await site.watch({ serve: false })
  const page = await readFile(join(dest, 'index.html'), 'utf8')
  await writeFiles(copy, { 'index.html': 'collision' })
  await waitFor(() => logs.some(line => line.includes('Output path conflict')))
  await settle(site)
  assert.equal(await readFile(join(dest, 'index.html'), 'utf8'), page)
  assert.ok(logs.some(line => line.includes('Output path conflict')))
  await rm(join(copy, 'index.html'))
  await rename(join(copy, 'copy.txt'), join(copy, 'renamed.txt'))
  await settle(site)
  await assert.rejects(stat(join(dest, 'copy.txt')), { code: 'ENOENT' })
  assert.equal(await readFile(join(dest, 'renamed.txt'), 'utf8'), 'old')
})

test('service worker sourcemaps retain phase ownership across rebuilds and removal', { timeout: 30_000 }, async t => {
  const { site, src, dest, logs } = await setup(t, {
    'page.html': 'page',
    'client.js': 'console.log(1)',
    'service-worker.js': 'console.log(1)',
    'a.template.js': template('a.txt'),
  })
  await site.watch({ serve: false })
  await writeFile(join(src, 'service-worker.js'), 'console.log(2)')
  await writeFile(join(src, 'client.js'), 'console.log(2)')
  await settle(site)
  assert.ok(!logs.some(line => line.includes('Output path conflict')))
  await writeFile(join(src, 'a.template.js'), template('service-worker.js.map'))
  await settle(site)
  assert.ok(logs.some(line => line.includes('Output path conflict')))
  assert.ok((await readFile(join(dest, 'service-worker.js.map'), 'utf8')).includes('sources'))
  await rm(join(src, 'service-worker.js'))
  await settle(site)
  await writeFile(join(src, 'a.template.js'), template('service-worker.js.map', 'reclaimed'))
  await settle(site)
  assert.equal(await readFile(join(dest, 'service-worker.js.map'), 'utf8'), 'reclaimed')
})

test('initial watch conflicts leave the previous destination untouched and recover', { timeout: 30_000 }, async t => {
  const { site, src, dest, logs } = await setup(t, {
    'page.html': 'new page',
    'client.js': 'console.log(1)',
    'a.template.js': template('client.js', 'collision'),
  })
  await writeFiles(dest, { 'index.html': 'old page', 'client.js': 'old bundle' })
  await site.watch({ serve: false })
  assert.ok(logs.some(line => line.includes('Output path conflict')))
  assert.equal(await readFile(join(dest, 'index.html'), 'utf8'), 'old page')
  assert.equal(await readFile(join(dest, 'client.js'), 'utf8'), 'old bundle')
  await writeFile(join(src, 'a.template.js'), template('safe.txt', 'recovered'))
  await settle(site)
  assert.equal(await readFile(join(dest, 'index.html'), 'utf8'), 'new page')
  assert.equal(await readFile(join(dest, 'safe.txt'), 'utf8'), 'recovered')
  assert.match(await readFile(join(dest, 'client.js'), 'utf8'), /console.log/)
})

test('page promotion revalidates ownership acquired by esbuild during rendering', { timeout: 30_000 }, async t => {
  const { site, src, dest, logs } = await setup(t, {
    'page.html': 'page',
    'client.js': 'console.log(1)',
    'payload.bin': 'esbuild asset',
    'a.template.js': template('a.txt', 'old template'),
    'esbuild.settings.js': "export default opts => ({ ...opts, assetNames: '[name]', loader: { ...opts.loader, '.bin': 'file' } })",
  }, { static: false })
  await site.watch({ serve: false })
  await writeFile(join(src, 'a.template.js'), `import { writeFile } from 'node:fs/promises'
export default async () => {
  await writeFile(new URL('./.rendering', import.meta.url), '')
  await new Promise(resolve => setTimeout(resolve, 1200))
  return { outputName: 'payload.bin', content: 'template collision' }
}`)
  for (let i = 0; i < 100; i++) {
    if (await stat(join(src, '.rendering')).then(() => true, () => false)) break
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  await stat(join(src, '.rendering'))
  await writeFile(join(src, 'client.js'), "import asset from './payload.bin'; console.log(asset)")
  await settle(site)
  assert.equal(await readFile(join(dest, 'payload.bin'), 'utf8'), 'esbuild asset')
  assert.equal(await readFile(join(dest, 'a.txt'), 'utf8'), 'old template')
  assert.ok(logs.some(line => line.includes('Output path conflict')))
  await writeFile(join(src, 'a.template.js'), template('a.txt', 'recovered'))
  await settle(site)
  assert.equal(await readFile(join(dest, 'a.txt'), 'utf8'), 'recovered')
  assert.equal(await readFile(join(dest, 'payload.bin'), 'utf8'), 'esbuild asset')
})

test('a producer can replace its own file with a directory and back', { timeout: 30_000 }, async t => {
  const { site, src, dest } = await setup(t, { 'a.template.js': template('feed', 'file') })
  await site.watch({ serve: false })
  await writeFile(join(src, 'a.template.js'), template('feed/index.xml', 'nested'))
  await settle(site)
  assert.equal(await readFile(join(dest, 'feed/index.xml'), 'utf8'), 'nested')
  await writeFile(join(src, 'a.template.js'), template('feed', 'file again'))
  await settle(site)
  assert.equal(await readFile(join(dest, 'feed'), 'utf8'), 'file again')
})

test('manifest hooks claim outputs and receive the public destination', async t => {
  const { src, dest } = await setup(t, { 'page.html': 'page' })
  const site = new DomStack(src, dest, {
    domstackManifest: {
      hooks: {
        manifestBuilt: [async ({ dest: hookDest, writeFile }) => {
          assert.equal(hookDest, dest)
          await writeFile('index.html', 'conflict')
        }],
      },
    },
  })
  await assert.rejects(site.build(), error => !!conflict(error))
  assert.equal(await readFile(join(dest, 'index.html'), 'utf8'), 'page')
})

test('one-shot hooks can immediately read their writes at the public destination', async t => {
  const { src, dest } = await setup(t, { 'page.html': 'page' })
  await writeFiles(dest, { 'hook.txt': 'old' })
  const site = new DomStack(src, dest, {
    domstackManifest: {
      hooks: {
        manifestBuilt: [async ({ dest: hookDest, writeFile }) => {
          await writeFile('hook.txt', 'new')
          assert.equal(await readFile(join(hookDest, 'hook.txt'), 'utf8'), 'new')
          await writeFile('brand-new.txt', 'first write')
          assert.equal(await readFile(join(hookDest, 'brand-new.txt'), 'utf8'), 'first write')
        }],
      },
    },
  })
  await site.build()
})

for (const watch of [false, true]) {
  test(`copy reports keep live public mappers (full-watch staging: ${watch})`, async t => {
    const { src, dest, tmp } = await setup(t, { 'asset.txt': 'static', 'client.js': 'console.log(1)', 'service-worker.js': 'console.log(2)' })
    const copyDir = join(tmp, 'copy')
    await writeFiles(copyDir, { 'copied.txt': 'copy' })
    const result = await builder(src, dest, { copy: [copyDir] }, { watch })
    for (const value of [result.staticResults?.report, ...Object.values(result.copyResults?.report ?? {})]) {
      const report = /** @type {{ options: { outputDir: string, toDestination: (source: string) => string }, copied: { source: string, output: string }[] }} */ (value)
      assert.equal(report.options.outputDir, dest)
      for (const file of report.copied) {
        assert.equal(report.options.toDestination(file.source), file.output)
        assert.equal(await readFile(file.output, 'utf8'), await readFile(file.source, 'utf8'))
      }
    }
    assert.doesNotMatch(JSON.stringify(result), /\.domstack-(stage|copy|pages)-[a-zA-Z0-9]{6}/)
    for (const name of (await readdir(dest)).filter(name => name.endsWith('.map'))) {
      const map = JSON.parse(await readFile(join(dest, name), 'utf8'))
      for (const source of map.sources) await stat(resolve(dest, source))
    }
  })
}

for (const sameContents of [false, true]) {
  test(`esbuild entry aliases identify both sources (identical contents: ${sameContents})`, async t => {
    const { site } = await setup(t, {
      'a.js': 'console.log(1)',
      'b.js': sameContents ? 'console.log(1)' : 'console.log(2)',
      'esbuild.settings.js': 'export default opts => ({ ...opts, entryPoints: [new URL(\'./a.js\', import.meta.url).pathname, new URL(\'./b.js\', import.meta.url).pathname], entryNames: \'shared\' })',
    })
    await assert.rejects(site.build(), error => {
      const found = conflict(error)
      assert.ok(found)
      assert.match(found.message, /a\.js/)
      assert.match(found.message, /b\.js/)
      assert.match(found.message, /shared\.js/)
      return true
    })
  })
}

for (const paths of [['Feed.xml', 'feed.xml'], ['Feed', 'feed/index.xml']]) {
  test(`copy inventory checks case aliases before staging: ${paths.join(', ')}`, async t => {
    const { src, dest } = await setup(t, {})
    if (await isCaseInsensitiveDest(src)) return t.skip('Source filesystem cannot represent both aliases')
    await writeFiles(src, Object.fromEntries(paths.map((path, i) => [path, String(i)])))
    const registry = new OutputRegistry([], { caseInsensitive: true })
    await assert.rejects(stagedCopy(join(src, '**'), src, dest, 'copy', registry), error => !!conflict(error))
    assert.ok(paths[0])
    await assert.rejects(stat(join(dest, paths[0])), { code: 'ENOENT' })
  })
}

test('worker returns a replacement delta including empty factories and deleted producers without dependency tracking', async t => {
  const { src, dest } = await setup(t, { 'empty.pages.js': 'export default []' })
  const emptyOwner = `pages-file:${join(src, 'empty.pages.js')}`
  const deletedOwner = `template:${join(src, 'deleted.template.js')}`
  const previousOutputClaims = [
    { outputRelname: 'old.html', owner: { id: emptyOwner, type: 'page', path: 'empty.pages.js' } },
    { outputRelname: 'deleted.txt', owner: { id: deletedOwner, type: 'template', path: 'deleted.template.js' } },
    { outputRelname: 'asset.txt', owner: { id: 'static:asset.txt', type: 'static', path: 'asset.txt' } },
  ]
  const result = await buildPages(src, dest, await identifyPages(src), { previousOutputClaims })
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.report.newClaims, [])
  assert.deepEqual(new Set(result.report.replacedOwnerIds), new Set([emptyOwner, deletedOwner]))
  assert.ok(!('outputClaims' in result.report))
})

test('watch uses its live copy inventory when files are renamed before initial rendering', { timeout: 30_000 }, async t => {
  const { site, src, dest, logs } = await setup(t, {
    'old.txt': 'copied',
    'a.template.js': template('old.txt', 'page now owns old path'),
    'esbuild.settings.js': `import { access, writeFile } from 'node:fs/promises'
export default async opts => {
  await writeFile(new URL('./.esbuild-started', import.meta.url), '')
  while (!await access(new URL('./.continue', import.meta.url)).then(() => true, () => false)) await new Promise(resolve => setTimeout(resolve, 20))
  return opts
}`,
  }, { ignore: ['.esbuild-started', '.continue'] })
  const startup = site.watch({ serve: false })
  await waitFor(() => stat(join(src, '.esbuild-started')).then(() => true, () => false))
  await rename(join(src, 'old.txt'), join(src, 'new.txt'))
  const stageName = (await readdir(dest)).find(name => name.startsWith('.domstack-copy-watch-'))
  assert.ok(stageName)
  const stagedOld = join(dest, stageName, createHash('sha256').update(join(src, 'old.txt')).digest('hex'))
  await waitFor(() => stat(stagedOld).then(() => false, () => true))
  await waitFor(() => logs.some(line => line.includes('Copy ') && line.includes('new.txt')))
  await writeFile(join(src, '.continue'), '')
  await startup
  assert.equal(await readFile(join(dest, 'old.txt'), 'utf8'), 'page now owns old path')
  assert.equal(await readFile(join(dest, 'new.txt'), 'utf8'), 'copied')
  assert.ok(!logs.some(line => line.includes('Output path conflict')))
  assert.equal(logs.filter(line => line.includes('Copy ') && line.includes('old.txt')).length, 1)
})

test('copy changes during initial rendering and onInitialBuild are drained', { timeout: 30_000 }, async t => {
  const { site, src, dest, logs } = await setup(t, {
    'asset.txt': 'initial',
    'a.template.js': `import { writeFile } from 'node:fs/promises'
export default async () => {
  await writeFile(new URL('./asset.txt', import.meta.url), 'during render')
  await new Promise(resolve => setTimeout(resolve, 500))
  return { outputName: 'page.txt', content: 'page' }
}`,
  })
  await site.watch({
    serve: false,
    onInitialBuild: async () => {
      assert.equal(await readFile(join(dest, 'asset.txt'), 'utf8'), 'during render')
      const before = logs.filter(line => line.includes('Copy ') && line.includes('asset.txt')).length
      await writeFile(join(src, 'asset.txt'), 'during callback')
      await waitFor(() => logs.filter(line => line.includes('Copy ') && line.includes('asset.txt')).length > before)
    }
  })
  await site.settled()
  assert.equal(await readFile(join(dest, 'asset.txt'), 'utf8'), 'during callback')
})

test('watch recovers after a page promotion I/O failure once the obstruction is removed', { timeout: 30_000 }, async t => {
  const { site, src, dest, logs } = await setup(t, { 'a.template.js': template('old.txt', 'old') })
  await site.watch({ serve: false })
  await writeFiles(dest, { 'blocked.txt/unowned.txt': 'keep' })
  await writeFile(join(src, 'a.template.js'), template('blocked.txt', 'new'))
  await settle(site)
  assert.equal(await readFile(join(dest, 'blocked.txt/unowned.txt'), 'utf8'), 'keep')
  assert.ok(logs.some(line => line.includes('EISDIR')))
  await rm(join(dest, 'blocked.txt'), { recursive: true })
  await writeFile(join(src, 'a.template.js'), template('blocked.txt', 'recovered'))
  await settle(site)
  assert.equal(await readFile(join(dest, 'blocked.txt'), 'utf8'), 'recovered')
  await assert.rejects(stat(join(dest, 'old.txt')), { code: 'ENOENT' })
})

test('native esbuild CSS bundle collisions identify both entry sources', async t => {
  const { site } = await setup(t, {
    'a/client.js': "import './imported.css'",
    'a/imported.css': 'body { color: red }',
    'b/client.css': 'body { color: blue }',
    'esbuild.settings.js': 'export default opts => ({ ...opts, entryPoints: [new URL(\'./a/client.js\', import.meta.url).pathname, new URL(\'./b/client.css\', import.meta.url).pathname], entryNames: \'[name]\' })',
  })
  await assert.rejects(site.build(), error => {
    const found = conflict(error)
    assert.ok(found, String(error))
    assert.match(found.message, /a\/client\.js/)
    assert.match(found.message, /b\/client\.css/)
    assert.match(found.message, /client\.css/)
    return true
  })
})

test('one-shot and full-watch stages support a symlinked destination', async t => {
  const { src, dest, tmp, site } = await setup(t, { 'page.html': 'page', 'asset.txt': 'static' })
  const actualDest = join(tmp, 'actual')
  await mkdir(actualDest)
  await symlink(actualDest, dest, 'dir')
  for (const watch of [false, true]) {
    const result = await builder(src, dest, {}, { watch })
    assert.equal(result.pageBuildResults?.outputs[0]?.filepath, join(dest, 'index.html'))
    assert.equal(await readFile(join(actualDest, 'index.html'), 'utf8'), 'page')
    assert.ok(!(await readdir(actualDest)).some(name => name.startsWith('.domstack-')))
  }
  await site.watch({ serve: false })
  assert.equal(await readFile(join(actualDest, 'asset.txt'), 'utf8'), 'static')
  await site.stopWatching()
  assert.ok(!(await readdir(actualDest)).some(name => name.startsWith('.domstack-')))
})

for (const watch of [false, true]) {
  test(`failed page reports describe public paths (full-watch staging: ${watch})`, async t => {
    const { src, dest } = await setup(t, {
      'page.html': 'successful render',
      'a.template.js': `export default async () => {
  await new Promise(resolve => setTimeout(resolve, 100))
  throw new Error('render failed')
}`,
    })
    await assert.rejects(builder(src, dest, {}, { watch }), error => {
      assert.ok(error instanceof DomStackAggregateError)
      assert.equal(error.results.pageBuildResults.report.pages[0].pageFilePath, join(dest, 'index.html'))
      assert.doesNotMatch(JSON.stringify(error.results), /\.domstack-(stage|copy|pages)-[a-zA-Z0-9]{6}/)
      return true
    })
    await assert.rejects(stat(join(dest, 'index.html')), { code: 'ENOENT' })
    assert.ok(!(await readdir(dest)).some(name => name.startsWith('.domstack-')))
  })
}

for (const phase of ['copy', 'esbuild']) {
  test(`initial ${phase} conflicts abort watch and clean up startup resources`, async t => {
    const { src, dest, tmp, sites } = await setup(t, {
      ...(phase === 'copy'
        ? { 'asset.txt': 'static' }
        : {
            'a.js': 'console.log(1)',
            'b.js': 'console.log(2)',
            'esbuild.settings.js': 'export default opts => ({ ...opts, entryPoints: [new URL(\'./a.js\', import.meta.url).pathname, new URL(\'./b.js\', import.meta.url).pathname], entryNames: \'shared\' })',
          }),
    })
    const copyDir = join(tmp, 'copy')
    await writeFiles(copyDir, { 'asset.txt': 'copy' })
    const site = new DomStack(src, dest, { copy: phase === 'copy' ? [copyDir] : [], logger: pino({ level: 'silent' }) })
    sites.push(site)
    await writeFiles(dest, { 'sentinel.txt': 'old destination' })
    await assert.rejects(site.watch({ serve: false }), error => !!conflict(error))
    assert.equal(site.watching, false)
    assert.deepEqual(await readdir(dest), ['sentinel.txt'])
  })
}

test('overlapping copy roots retain both mappings through watch startup, edits, full rebuilds, renames and removal', { timeout: 30_000 }, async t => {
  const { src, dest, tmp, sites, logs } = await setup(t, { 'page.html': 'page' })
  const assets = join(tmp, 'assets')
  const nested = join(assets, 'nested')
  await writeFiles(nested, { 'asset.txt': 'initial' })
  const opts = { copy: [assets, nested], logger: pino({ level: 'debug' }, { write: line => logs.push(line) }) }
  const site = new DomStack(src, dest, opts)
  sites.push(site)
  const assertMappings = async (/** @type {string} */ name, /** @type {string} */ content) => {
    for (const path of [name, join('nested', name)]) assert.equal(await readFile(join(dest, path), 'utf8'), content)
  }
  const assertRemoved = async (/** @type {string} */ name) => {
    for (const path of [name, join('nested', name)]) await assert.rejects(stat(join(dest, path)), { code: 'ENOENT' })
  }
  await site.build()
  await assertMappings('asset.txt', 'initial')
  await rm(dest, { recursive: true })
  await site.watch({ serve: false })
  await assertMappings('asset.txt', 'initial')
  await writeFile(join(nested, 'asset.txt'), 'edited')
  await settle(site)
  await assertMappings('asset.txt', 'edited')

  await writeFile(join(src, 'global.vars.js'), "export default { layout: 'root', rebuilt: true }")
  await settle(site)
  assert.ok(logs.some(line => line.includes('Triggering full rebuild')))
  await assertMappings('asset.txt', 'edited')
  await writeFile(join(nested, 'asset.txt'), 'after full rebuild')
  await settle(site)
  await assertMappings('asset.txt', 'after full rebuild')

  await rename(join(nested, 'asset.txt'), join(nested, 'renamed.txt'))
  await settle(site)
  await assertRemoved('asset.txt')
  await assertMappings('renamed.txt', 'after full rebuild')
  await rm(join(nested, 'renamed.txt'))
  await settle(site)
  await assertRemoved('renamed.txt')
  await writeFile(join(nested, 'asset.txt'), 'recreated')
  await settle(site)
  await assertMappings('asset.txt', 'recreated')
  assert.ok(!logs.some(line => line.includes('Output path conflict')))

  // A new file in the outer root cannot take the inner mapping's output, and
  // removing that rejected producer must not remove the successful mapping.
  await writeFile(join(assets, 'asset.txt'), 'conflicting outer file')
  await settle(site)
  assert.ok(logs.some(line => line.includes('Output path conflict')))
  await assertMappings('asset.txt', 'recreated')
  await rm(join(assets, 'asset.txt'))
  await settle(site)
  await assertMappings('asset.txt', 'recreated')
})

for (const repeatedRoot of [false, true]) {
  test(`copy root mappings that emit the same output still conflict (repeated root: ${repeatedRoot})`, async t => {
    const { src, dest, tmp, sites } = await setup(t, {})
    const assets = join(tmp, 'assets')
    const nested = join(assets, 'nested')
    await writeFiles(assets, { 'asset.txt': 'root', 'nested/asset.txt': 'nested' })
    const opts = { copy: [assets, repeatedRoot ? assets : nested], logger: pino({ level: 'silent' }) }
    for (const watch of [false, true]) {
      await assert.rejects(builder(src, dest, opts, { watch }), error => !!conflict(error))
    }
    await rm(dest, { recursive: true, force: true })
    const site = new DomStack(src, dest, opts)
    sites.push(site)
    await assert.rejects(site.watch({ serve: false }), error => !!conflict(error))
    assert.equal(site.watching, false)
  })
}
