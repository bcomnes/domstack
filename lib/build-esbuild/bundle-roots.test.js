/**
 * @import { TestContext } from 'node:test'
 * @import { BuildOptions, PluginBuild } from 'esbuild'
 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { identifyPages } from '../identify-pages.js'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { DomStack } from '../../index.js'
import { buildEsbuild, buildEsbuildWatch, createBundleBuilds, normalizeBundleRoots } from './index.js'

/**
 * @param {TestContext} t
 * @param {string} settings
 */
async function createFixture (t, settings) {
  const root = await mkdtemp(join(tmpdir(), 'domstack-bundle-roots-'))
  const src = join(root, 'src')
  const dest = join(root, 'public')
  await mkdir(src, { recursive: true })
  await Promise.all(Object.entries({
    'global.vars.js': "export default { layout: 'root' }\n",
    'root.layout.js': 'export default ({ children }) => children\n',
    'shared.js': "export const shared = 'shared bundle marker'\n",
    'page.js': "export default () => 'Public one'\n",
    'client.js': "import { shared } from './shared.js'; console.log(shared)\n",
    'other/page.js': "export default () => 'Public two'\n",
    'other/client.js': "import { shared } from '../shared.js'; console.log(shared)\n",
    'admin/page.js': "export default () => 'Admin one'\n",
    'admin/client.js': "import { shared } from '../shared.js'; console.log(shared)\n",
    'admin/other/page.js': "export default () => 'Admin two'\n",
    'admin/other/client.js': "import { shared } from '../../shared.js'; console.log(shared)\n",
    'esbuild.settings.js': settings,
  }).map(async ([relname, content]) => {
    const filepath = join(src, relname)
    await mkdir(dirname(filepath), { recursive: true })
    await writeFile(filepath, content)
  }))

  t.after(() => rm(root, { recursive: true, force: true }))
  return { root, src, dest }
}

/** @param {BuildOptions['entryPoints']} entryPoints */
function entryPointInputs (entryPoints) {
  if (!entryPoints) return []
  if (Array.isArray(entryPoints)) {
    return entryPoints.map(entry => typeof entry === 'string' ? entry : entry.in)
  }
  return Object.values(entryPoints)
}

test('rejects unsupported root inputs without changing no-root options', () => {
  for (const root of ['C:admin', 'C:../outside', 'c:', './C:admin']) {
    assert.throws(() => normalizeBundleRoots([root]), /must be relative/)
  }
  for (const entryPoints of [['**/client.js'], [{ in: 'admin/*.js', out: 'app' }], { app: '**/client.js' }]) {
    const options = { entryPoints }
    assert.throws(() => createBundleBuilds(options, tmpdir(), ['admin']), /glob entryPoints/)
    assert.equal(createBundleBuilds(options, tmpdir(), [])[0]?.buildOpts, options)
  }
  for (const entryPoints of [[], ['client.js']]) {
    const options = { entryPoints, stdin: { contents: 'console.log(1)' } }
    assert.throws(() => createBundleBuilds(options, tmpdir(), ['admin']), /stdin/)
    assert.equal(createBundleBuilds(options, tmpdir(), [])[0]?.buildOpts, options)
  }
})

test('normalizes and validates bundle roots', () => {
  assert.deepEqual(
    normalizeBundleRoots(['admin/reports/', 'members\\settings']),
    ['admin/reports', 'members/settings']
  )
  assert.throws(() => normalizeBundleRoots('admin'), /must be an array/)
  assert.throws(() => normalizeBundleRoots(['']), /non-empty string/)
  assert.throws(() => normalizeBundleRoots(['/admin']), /must be relative/)
  assert.throws(() => normalizeBundleRoots(['C:\\admin']), /must be relative/)
  assert.throws(() => normalizeBundleRoots(['.']), /inside the source directory/)
  assert.throws(() => normalizeBundleRoots(['../admin']), /inside the source directory/)
  assert.throws(() => normalizeBundleRoots(['admin', 'admin/']), /duplicate paths/)
})

test('assigns entries to the deepest matching bundle root without prefix collisions', () => {
  const src = join(tmpdir(), 'bundle-root-assignment', 'src')
  const builds = createBundleBuilds({
    entryPoints: [
      join(src, 'client.js'),
      join(src, 'admin', 'client.js'),
      join(src, 'admin', 'reports', 'client.js'),
      join(src, 'administrator', 'client.js'),
    ],
    chunkNames: 'chunks/[name]-[hash]',
  }, src, ['admin', 'admin/reports'])

  assert.deepEqual(builds.map(build => build.bundleRoot), [null, 'admin', 'admin/reports'])
  assert.deepEqual(
    entryPointInputs(builds[0]?.buildOpts.entryPoints),
    [join(src, 'client.js'), join(src, 'administrator', 'client.js')]
  )
  assert.deepEqual(entryPointInputs(builds[1]?.buildOpts.entryPoints), [join(src, 'admin', 'client.js')])
  assert.deepEqual(entryPointInputs(builds[2]?.buildOpts.entryPoints), [join(src, 'admin', 'reports', 'client.js')])
  assert.equal(builds[1]?.buildOpts.chunkNames, 'admin/chunks/[name]-[hash]')
  assert.equal(builds[2]?.buildOpts.assetNames, 'admin/reports/[name]-[hash]')
})

test('builds named roots in isolated graphs and merges their reports', async t => {
  const { src, dest } = await createFixture(t, `
export const bundleRoots = ['admin']
export default options => options
`)
  const domstack = new DomStack(src, dest)
  const results = await domstack.build()
  const builds = results.esbuildResults.report.builds ?? []

  assert.deepEqual(builds.map(build => build.bundleRoot), [null, 'admin'])
  assert.ok(entryPointInputs(builds[0]?.buildOpts.entryPoints).every(input => !input.startsWith(join(src, 'admin'))))
  assert.ok(entryPointInputs(builds[1]?.buildOpts.entryPoints).every(input => input.startsWith(join(src, 'admin'))))

  const defaultOutputs = Object.keys(builds[0]?.buildResults.metafile?.outputs ?? {})
  const adminOutputs = Object.keys(builds[1]?.buildResults.metafile?.outputs ?? {})
  assert.ok(defaultOutputs.some(output => output.includes('/chunks/js/')))
  assert.ok(adminOutputs.some(output => output.includes('/admin/chunks/js/')))
  assert.ok(!defaultOutputs.some(output => output.includes('/admin/chunks/js/')))

  const mergedMetafile = JSON.parse(await readFile(join(dest, 'domstack-esbuild-meta.json'), 'utf8'))
  assert.deepEqual(
    Object.keys(mergedMetafile.outputs).sort(),
    [...defaultOutputs, ...adminOutputs].sort()
  )
  assert.ok(Object.keys(results.esbuildResults.report.outputMap ?? {}).some(input => input === 'client.js'))
  assert.ok(Object.keys(results.esbuildResults.report.outputMap ?? {}).some(input => input === 'admin/client.js'))

  const rootPage = results.siteData.pages.find(page => page.path === '')
  const adminPage = results.siteData.pages.find(page => page.path === 'admin')
  assert.match(rootPage?.clientBundle?.outputRelname ?? '', /^client-.+\.js$/)
  assert.match(adminPage?.clientBundle?.outputRelname ?? '', /^admin\/client-.+\.js$/)
})

test('watch creates and disposes one browser context per bundle root group', async t => {
  const { src, dest } = await createFixture(t, `
import { appendFileSync } from 'node:fs'
export const bundleRoots = ['admin']
export default options => ({
  ...options,
  plugins: [{
    name: 'bundle-root-context-lifecycle',
    setup (build) {
      appendFileSync(import.meta.dirname + '/context-events.txt', 'setup\\n')
      build.onDispose(() => appendFileSync(import.meta.dirname + '/context-events.txt', 'dispose\\n'))
    },
  }],
})
`)
  const domstack = new DomStack(src, dest)
  t.after(async () => {
    if (domstack.watching) await domstack.stopWatching()
  })

  await domstack.watch({ serve: false })
  assert.equal(await readFile(join(src, 'context-events.txt'), 'utf8'), 'setup\nsetup\n')
  await domstack.stopWatching()
  const eventsPath = join(src, 'context-events.txt')
  for (let i = 0; i < 100; i++) {
    if ((await readFile(eventsPath, 'utf8')).endsWith('dispose\ndispose\n')) break
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.equal(await readFile(eventsPath, 'utf8'), 'setup\nsetup\ndispose\ndispose\n')
})

/** @param {() => boolean | Promise<boolean>} predicate */
async function until (predicate) {
  for (let i = 0; i < 300; i++) {
    if (await predicate()) return
    await delay(10)
  }
  assert.fail('Timed out waiting for build event')
}

/**
 * Expose per-fixture plugin controls without global state or esbuild mocks.
 * @param {TestContext} t
 * @param {string} [extra]
 */
async function controlledFixture (t, extra = '') {
  const settings = `export const bundleRoots = ['admin']
export let plugin
export function setPlugin(value) { plugin = value }
export default options => ({ ...options, ${extra} plugins: plugin ? [plugin] : [] })
`
  const fixture = await createFixture(t, settings)
  await mkdir(fixture.dest)
  const url = pathToFileURL(join(fixture.src, 'esbuild.settings.js'))

  const controls = await import(url.href)
  const siteData = await identifyPages(fixture.src)
  return { ...fixture, siteData, controls }
}

test('explicit entries retain ownership across dynamic-import copies in production and watch', async t => {
  const { src, dest, siteData } = await controlledFixture(t)
  await writeFile(join(src, 'admin/client.js'), 'import("../client.js").then(console.log)')
  const production = await buildEsbuild(src, dest, siteData, {})
  assert.deepEqual(production.errors, [])
  const groups = production.report.builds ?? []
  assert.match(groups[1]?.outputMap['client.js'] ?? '', /^admin\/chunks\//)
  assert.equal(production.report.outputMap?.['client.js'], groups[0]?.outputMap['client.js'])
  assert.match(siteData.pages.find(page => page.path === '')?.clientBundle?.outputRelname ?? '', /^client-/)
  const watch = await buildEsbuildWatch(src, dest, siteData, {})
  try {
    assert.equal(watch.outputMap['client.js'], 'client.js')
  } finally {
    await watch.context.dispose()
  }
})

test('aggregate preserves outputFiles, omits absent metafiles and keeps mangle caches per group', async t => {
  const { src, dest, siteData } = await controlledFixture(t, 'write: false, metafile: false, mangleCache: {}, mangleProps: /_$/,')
  await writeFile(join(src, 'client.js'), 'console.log({ public_: 1 }.public_)')
  await writeFile(join(src, 'admin/client.js'), 'console.log({ admin_: 1 }.admin_)')
  const result = await buildEsbuild(src, dest, siteData, {})
  assert.deepEqual(result.errors, [])
  const groups = result.report.builds ?? []
  assert.equal(groups.length, 2)
  assert.deepEqual(result.report.buildResults?.outputFiles, groups.flatMap(group => group.buildResults.outputFiles ?? []))
  assert.ok(result.report.buildResults?.outputFiles?.length)
  assert.equal(result.report.buildResults?.metafile, undefined)
  assert.equal(result.report.buildResults?.mangleCache, undefined)
  assert.ok(groups.every(group => group.buildResults.mangleCache))
  await assert.rejects(readFile(join(dest, 'domstack-esbuild-meta.json')), { code: 'ENOENT' })
})

for (const metafile of [false, true]) {
  test(`rejects outputFiles collisions with metafile: ${metafile} in production and watch`, async t => {
    const { src, dest, siteData } = await controlledFixture(t, `write: false, metafile: ${metafile}, entryNames: '[name]', entryPoints: [options.outbase + '/client.js', options.outbase + '/admin/client.js'],`)
    await writeFile(join(src, 'client.js'), 'console.log("public")')
    await writeFile(join(src, 'admin/client.js'), 'console.log("admin")')
    const result = await buildEsbuild(src, dest, siteData, {})
    assert.equal(result.errors.length, 1)
    const error = result.errors[0]
    assert.ok(error instanceof Error)
    assert.ok(error.cause instanceof Error)
    assert.match(error.cause.message, /conflicting esbuild output .*client\.js/)
    await assert.rejects(buildEsbuildWatch(src, dest, siteData, {}), /conflicting esbuild output .*client\.js/)
  })
}

test('multiple production group failures return all diagnostics instead of rejecting', async t => {
  const { src, dest, siteData } = await controlledFixture(t)
  await writeFile(join(src, 'client.js'), 'public syntax error !!!')
  await writeFile(join(src, 'admin/client.js'), 'admin syntax error !!!')
  const result = await buildEsbuild(src, dest, siteData, {})
  assert.equal(result.errors.length, 1)
  const error = result.errors[0]
  assert.ok(error instanceof Error)
  assert.ok(error.cause instanceof AggregateError)
  assert.equal(error.cause.errors.length, 2)
  for (const failure of error.cause.errors) {
    assert.ok(failure instanceof Error)
    const diagnostics = JSON.parse(JSON.stringify(failure))
    assert.equal(diagnostics.errors.length, 1)
    assert.ok(diagnostics.errors[0].location.file.endsWith('client.js'))
    assert.ok(Array.isArray(diagnostics.errors[0].notes))
  }
  assert.deepEqual(result.outputs, [])
})

test('no-root stdin builds keep exact esbuild results including mangleCache', async t => {
  const { src, dest } = await createFixture(t, `export default options => ({ ...options,
    entryPoints: [], stdin: { contents: 'console.log({ value_: 1 }.value_)' },
    write: false, mangleProps: /_$/, mangleCache: {},
  })`)
  await mkdir(dest)
  const result = await buildEsbuild(src, dest, await identifyPages(src), {})
  assert.deepEqual(result.errors, [])
  assert.equal(result.report.buildResults, result.report.builds?.[0]?.buildResults)
  assert.ok(result.report.buildResults?.outputFiles?.length)
  assert.ok(result.report.buildResults?.mangleCache)
  assert.ok(result.report.buildResults?.metafile)
})

for (const form of ['advanced', 'record']) {
  test(`explicit ownership works with ${form} entryPoints`, async t => {
    const { src, dest } = await createFixture(t, `export const bundleRoots = ['admin']
export default options => {
  const entries = [
    { in: options.outbase + '/client.js', out: 'public-alias' },
    { in: options.outbase + '/admin/client.js', out: 'admin-alias' },
  ]
  return { ...options, entryPoints: ${form === 'advanced' ? 'entries' : 'Object.fromEntries(entries.map(entry => [entry.out, entry.in]))'} }
}`)
    await mkdir(dest)
    await writeFile(join(src, 'admin/client.js'), 'import("../client.js").then(console.log)')
    const result = await buildEsbuild(src, dest, await identifyPages(src), {})
    assert.deepEqual(result.errors, [])
    assert.match(result.report.outputMap?.['client.js'] ?? '', /^public-alias-/)
    assert.match(result.report.outputMap?.['admin/client.js'] ?? '', /^admin-alias-/)
  })
}

test('production drains other groups before returning a failure', { timeout: 10000 }, async t => {
  const { src, dest, siteData, controls } = await controlledFixture(t)
  const entered = Promise.withResolvers()
  const release = Promise.withResolvers()
  let completed = false
  controls.setPlugin({
    name: 'gated-failure',
    setup (/** @type {PluginBuild} */ build) {
      const admin = entryPointInputs(build.initialOptions.entryPoints).some(input => input.includes(join('admin', 'client.js')))
      build.onStart(async () => {
        if (admin) {
          entered.resolve(undefined)
          await release.promise
        } else {
          await entered.promise
          return { errors: [{ text: 'intentional failure' }] }
        }
      })
      if (admin) build.onEnd(() => { completed = true })
    },
  })
  let returned = false
  const pending = buildEsbuild(src, dest, siteData, {}).then(result => { returned = true; return result })
  try {
    await entered.promise
    await delay(100)
    assert.equal(returned, false)
  } finally {
    release.resolve(undefined)
  }
  const result = await pending
  assert.equal(result.errors.length, 1)
  assert.equal(completed, true)
})

test('watch startup never publishes partial metadata and rebuilds retain every group', { timeout: 15000 }, async t => {
  const { src, dest, siteData, controls } = await controlledFixture(t)
  const entered = Promise.withResolvers()
  const release = Promise.withResolvers()
  let publicBuilds = 0
  let rebuilds = 0
  controls.setPlugin({
    name: 'gated-startup',
    setup (/** @type {PluginBuild} */ build) {
      const admin = entryPointInputs(build.initialOptions.entryPoints).some(input => input.includes(join('admin', 'client.js')))
      if (admin) build.onStart(async () => { entered.resolve(undefined); await release.promise })
      else build.onEnd(() => { publicBuilds++ })
    },
  })
  const starting = buildEsbuildWatch(src, dest, siteData, {}, { onEnd () { rebuilds++ } })
  try {
    await entered.promise
    await writeFile(join(src, 'client.js'), 'console.log("public changed during startup")')
    await until(() => publicBuilds >= 2 && rebuilds >= 1)
    await assert.rejects(readFile(join(dest, 'domstack-esbuild-meta.json')), { code: 'ENOENT' })
  } finally {
    release.resolve(undefined)
  }
  const watch = await starting
  try {
    const metaPath = join(dest, 'domstack-esbuild-meta.json')
    const initial = JSON.parse(await readFile(metaPath, 'utf8'))
    const publicOutputs = Object.keys(initial.outputs).filter(path => !path.includes('/admin/'))
    assert.ok(publicOutputs.length)
    const previous = rebuilds
    await writeFile(join(src, 'admin/client.js'), 'console.log("admin changed after startup")')
    await until(() => rebuilds > previous)
    const rebuilt = JSON.parse(await readFile(metaPath, 'utf8'))
    for (const output of publicOutputs) assert.deepEqual(rebuilt.outputs[output], initial.outputs[output])
    assert.ok(Object.keys(rebuilt.outputs).some(path => path.endsWith('/admin/client.js')))
  } finally {
    await watch.context.dispose()
  }
})

test('failed later watch startup disposes all acquired contexts', { timeout: 10000 }, async t => {
  const { src, dest, siteData, controls } = await controlledFixture(t)
  let setups = 0
  let disposals = 0
  controls.setPlugin({
    name: 'failed-startup',
    setup (/** @type {PluginBuild} */ build) {
      setups++
      build.onDispose(() => { disposals++ })
      if (entryPointInputs(build.initialOptions.entryPoints).some(input => input.includes(join('admin', 'client.js')))) {
        build.onStart(() => ({ errors: [{ text: 'intentional startup failure' }] }))
      }
    },
  })
  await assert.rejects(buildEsbuildWatch(src, dest, siteData, {}), /build failed/)
  await until(() => disposals === 2)
  assert.equal(setups, 2)
  await assert.rejects(readFile(join(dest, 'domstack-esbuild-meta.json')), { code: 'ENOENT' })
})

test('watch context restarts and production share the ordinary settings module despite file edits', async t => {
  const first = "import { appendFileSync } from 'node:fs'; appendFileSync(import.meta.dirname + '/loads.txt', 'load\\n'); export const bundleRoots = ['admin']; export const calls = []; export default o => { calls.push(o); return o }"
  const second = first.replace("['admin']", "['other']")
  const { src, dest } = await createFixture(t, first)
  await mkdir(dest)
  const settingsDir = join(src, 'settings #')
  await mkdir(settingsDir)
  await rm(join(src, 'esbuild.settings.js'))
  const path = join(settingsDir, 'esbuild.settings.js')
  await writeFile(path, first)
  const siteData = await identifyPages(src)
  const original = await import(pathToFileURL(path).href)
  let originalCalls = 0
  for (const contents of [first, second, second, first]) {
    await writeFile(path, contents)
    const watch = await buildEsbuildWatch(src, dest, siteData, {})
    try {
      const metafile = JSON.stringify(watch.buildResults.metafile)
      assert.ok(metafile.includes('/admin/chunks/js/'))
      assert.ok(!metafile.includes('/other/chunks/js/'))
      originalCalls++
      assert.equal(original.calls.length, originalCalls, 'watch contexts share the ordinary import state')
    } finally {
      await watch.context.dispose()
    }
  }
  const result = await buildEsbuild(src, dest, siteData, {})
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.report.builds?.map(build => build.bundleRoot), [null, 'admin'])
  assert.equal(original.calls.length, originalCalls + 1, 'production shares the ordinary import state')
  assert.equal(await import(pathToFileURL(path).href), original)
  assert.equal(await readFile(join(settingsDir, 'loads.txt'), 'utf8'), 'load\n')
})

test('CommonJS settings retain their named bundleRoots export and ordinary module identity after edits', async t => {
  const { src, dest } = await createFixture(t, '')
  await mkdir(dest)
  await rm(join(src, 'esbuild.settings.js'))
  const settings = join(src, 'esbuild.settings.cjs')
  let original
  let originalCalls = 0
  for (const root of ['admin', 'other', 'admin']) {
    await writeFile(settings, `module.exports = options => { module.exports.calls.push(options); return options }; module.exports.calls = []; module.exports.bundleRoots = ['${root}']`)
    original ??= await import(pathToFileURL(settings).href)
    const result = await buildEsbuild(src, dest, await identifyPages(src), {})
    assert.deepEqual(result.errors, [])
    assert.deepEqual(result.report.builds?.map(build => build.bundleRoot), [null, 'admin'])
    originalCalls++
    assert.equal(original.default.calls.length, originalCalls)
  }
  assert.equal(original.default.calls.length, 3)
  assert.equal(await import(pathToFileURL(settings).href), original)
})
