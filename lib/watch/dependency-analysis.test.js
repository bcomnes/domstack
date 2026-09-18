/**
 * @import { TestContext } from 'node:test'
 * @import { SiteData } from '../builder.js'
 * @import { WalkerFile, PageInfo, PageTypes } from '../identify-pages.js'
 * @import { DependencyObservation } from './dependency-index.js'
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import pino from 'pino'
import { WatchDependencyIndex } from './dependency-index.js'
import { classifyWatchEvent, planWatchEvent } from './plan.js'

const observed = () => true
const reuse = { reuseAnalysis: true, isObserved: observed }

/** @returns {SiteData} */
function emptySite () {
  return {
    pages: [],
    templates: [],
    pagesFiles: [],
    layouts: {},
    globalStyle: undefined,
    globalClient: undefined,
    serviceWorker: undefined,
    globalVars: undefined,
    globalData: undefined,
    esbuildSettings: undefined,
    markdownItSettings: undefined,
    domstackManifestSettings: undefined,
    defaultStyle: null,
    defaultClient: null,
    defaultLayout: false,
    warnings: [],
    errors: [],
  }
}

/** @param {TestContext} t */
function fixture (t) {
  // Synthetic paths: the injected finder performs no filesystem I/O.
  const src = resolve('test-fixtures/dependency-analysis')
  /** @type {Map<string, string[] | Error | (() => Promise<string[]>)>} */
  const graph = new Map()
  /** @type {Map<string, number>} */
  const calls = new Map()
  const logger = pino({ level: 'silent' })
  const debug = t.mock.method(logger, 'debug')
  const index = new WatchDependencyIndex(logger, async filepath => {
    calls.set(filepath, (calls.get(filepath) ?? 0) + 1)
    assert.ok(graph.has(filepath), `unexpected analysis: ${filepath}`)
    const result = graph.get(filepath)
    if (result instanceof Error) throw result
    return typeof result === 'function' ? result() : [...(result ?? [])]
  })
  /** @param {string} name @returns {WalkerFile} */
  const file = name => ({ root: src, filepath: join(src, name), relname: name, basename: basename(name), parentName: dirname(name) })
  /** @param {string} name @param {string[]} [dependencies] */
  const define = (name, dependencies = []) => {
    const info = file(name)
    graph.set(info.filepath, dependencies.map(dep => relative(process.cwd(), file(dep).filepath)))
    return info
  }
  /** @param {string} name @param {PageTypes} [type] @returns {PageInfo} */
  const page = (name, type = 'js') => ({
    pageFile: define(`${name}/page.${type}`),
    type,
    path: name,
    url: `/${name}/`,
    outputName: 'index.html',
    outputRelname: `${name}/index.html`,
    draft: false,
  })
  /** @param {string} name */
  const count = name => calls.get(file(name).filepath) ?? 0
  /** @param {string} name @param {'change' | 'added' | 'removed'} [type] */
  const event = (name, type = 'change') => {
    const event = classifyWatchEvent(type, file(name).filepath)
    index.recordEvent(event)
    return event
  }
  return { index, debug, graph, calls, file, define, page, count, event, site: emptySite() }
}

/** @param {PageInfo} page @param {string[]} layoutNames */
function report (page, layoutNames) {
  return { pageFilePath: page.pageFile.filepath, sourcePageFilePath: page.pageFile.filepath, layoutNames, outputs: [] }
}

test('fresh rebuilds bypass retained analysis and seed later opt-in reuse only with explicit observation', async t => {
  const { index, site, define, file, count } = fixture(t)
  site.globalData = define('global.data.js', ['before.json'])
  await index.rebuild(site)
  define('global.data.js', ['after.json'])
  await index.rebuild(site)
  assert.equal(count('global.data.js'), 2)
  assert.deepEqual(index.snapshot().globalDataDepPaths, new Set([site.globalData.filepath, file('after.json').filepath]))
  await index.rebuild(site, reuse)
  await index.rebuild(site, reuse)
  assert.equal(count('global.data.js'), 3)

  await index.rebuild(site, { isObserved: observed })
  assert.equal(count('global.data.js'), 4, 'omitting reuseAnalysis bypasses existing retention')
  await index.rebuild(site, reuse)
  assert.equal(count('global.data.js'), 4, 'explicit observation seeds eligible analysis for later opt-in reuse')
})

test('reuse requires observation opt-in and a stable predicate identity', async t => {
  const { index, site, define, count } = fixture(t)
  site.globalData = define('global.data.js')
  await index.rebuild(site, { reuseAnalysis: true })
  await index.rebuild(site, { reuseAnalysis: true })
  assert.equal(count('global.data.js'), 2, 'observation defaults to false')
  await index.rebuild(site, reuse)
  await index.rebuild(site, reuse)
  assert.equal(count('global.data.js'), 3)
  const replacement = () => true
  const options = { reuseAnalysis: true, isObserved: replacement }
  await index.rebuild(site, options)
  await index.rebuild(site, options)
  assert.equal(count('global.data.js'), 4, 'changing observation identity invalidates retained results')
})

test('retention requires the root and complete closure to be observed without affecting routing', async t => {
  for (const denied of ['global.data.js', 'missing.json', '../external/helper.js', 'rejected', 'thrown']) {
    const { index, site, define, file, count } = fixture(t)
    site.globalData = define('global.data.js', ['missing.json', '../external/helper.js'])
    site.globalVars = define('global.vars.js', ['safe.json'])
    /** @type {DependencyObservation} */
    const isObserved = filepath => {
      if (filepath === file('missing.json').filepath && denied === 'rejected') return Promise.reject(new Error('watch unavailable'))
      if (filepath === file('missing.json').filepath && denied === 'thrown') throw new Error('watch unavailable')
      return filepath !== file(denied).filepath
    }
    const options = { reuseAnalysis: true, isObserved }
    await index.rebuild(site, options)
    await index.rebuild(site, options)
    assert.equal(count('global.data.js'), 2, denied)
    assert.equal(count('global.vars.js'), 1, 'an unrelated fully observed closure is retained')
    assert.equal(index.snapshot().dependencyAnalysisFailed, false)
    assert.deepEqual(index.snapshot().globalDataDepPaths, new Set([
      site.globalData.filepath, file('missing.json').filepath, file('../external/helper.js').filepath,
    ]))
  }
  const { index, site, define, count } = fixture(t)
  site.globalData = define('global.data.js', ['../external/helper.js'])
  await index.rebuild(site, reuse)
  await index.rebuild(site, reuse)
  assert.equal(count('global.data.js'), 1, 'the predicate, not source-directory containment, decides observation')
})

test('distinct roots share observation promises for duplicate inputs, including failed observations', async t => {
  for (const outcome of ['observed', 'unobserved', 'thrown', 'rejected']) {
    const { index, site, define, file, count } = fixture(t)
    site.globalData = define('global.data.js', ['helper.json', 'helper.json'])
    site.globalVars = define('global.vars.js', ['global.data.js', 'helper.json'])
    /** @type {DependencyObservation} */
    const observe = filepath => {
      if (filepath !== file('helper.json').filepath) return true
      if (outcome === 'thrown') throw new Error('watch unavailable')
      if (outcome === 'rejected') return Promise.reject(new Error('watch unavailable'))
      return outcome === 'observed'
    }
    const isObserved = t.mock.fn(observe)
    const options = { reuseAnalysis: true, isObserved }
    const inputs = [site.globalData.filepath, file('helper.json').filepath, site.globalVars.filepath]
    for (let pass = 1; pass <= 2; pass++) {
      await index.rebuild(site, options)
      const analyses = outcome === 'observed' ? 1 : pass
      assert.deepEqual(['global.data.js', 'global.vars.js'].map(count), [analyses, analyses], outcome)
      assert.deepEqual(isObserved.mock.calls.map(call => call.arguments[0]).sort(),
        Array.from({ length: analyses }, () => inputs).flat().sort(),
        'each input is observed once per fresh pass, regardless of discovery order')
      const snapshot = index.snapshot()
      assert.equal(snapshot.dependencyAnalysisFailed, false, outcome)
      assert.deepEqual(snapshot.globalDataDepPaths, new Set([site.globalData.filepath, file('helper.json').filepath]))
      assert.deepEqual(snapshot.settingsDepPaths, new Set([site.globalVars.filepath, site.globalData.filepath, file('helper.json').filepath]))
    }
  }
})

test('successful shared roots deduplicate across all roles and retain absolute closures', async t => {
  const { index, site, define, file, page, count } = fixture(t)
  const shared = define('shared.js', ['helper.js', 'nested.json'])
  const home = { ...page('home'), pageFile: shared, pageVars: shared, clientBundle: shared }
  site.pages = [home]
  site.globalData = { ...shared, filepath: relative(process.cwd(), shared.filepath) }
  site.globalVars = shared
  site.markdownItSettings = shared
  site.esbuildSettings = shared
  site.layouts['root'] = { ...shared, layoutName: 'root', layoutClient: shared }
  site.templates = [{ templateFile: shared, path: '', outputName: 'feed.xml' }]
  site.pagesFiles = [{ pagesFile: shared, path: '', name: 'archive' }]
  site.globalClient = shared
  site.serviceWorker = shared
  const isObserved = t.mock.fn(observed)
  const options = { reuseAnalysis: true, isObserved }
  for (let pass = 0; pass < 2; pass++) {
    await index.rebuild(site, options)
    const snapshot = index.snapshot()
    assert.equal(count('shared.js'), 1)
    assert.equal(isObserved.mock.callCount(), 3, 'observe the root and each transitive input once, only on fresh analysis')
    for (const dependency of ['helper.js', 'nested.json']) {
      const path = file(dependency).filepath
      assert.deepEqual(snapshot.pageDepMap.get(path), new Set([home]))
      assert.deepEqual(snapshot.layoutDepMap.get(path), new Set(['root']))
      assert.deepEqual(snapshot.templateDepMap.get(path), new Set(site.templates))
      assert.deepEqual(snapshot.pagesFileDepMap.get(path), new Set(site.pagesFiles))
      assert.ok(snapshot.globalDataDepPaths.has(path))
      assert.ok(snapshot.settingsDepPaths?.has(path))
      assert.ok(snapshot.esbuildDepPaths?.has(path))
    }
    assert.equal(snapshot.dependencyAnalysisFailed, false)
  }
})

test('root edits and shared transitive edits refresh affected closures while other roots reuse', async t => {
  const { index, site, define, file, count, event } = fixture(t)
  site.globalData = define('global.data.js', ['direct.js', 'leaf.json'])
  site.globalVars = define('global.vars.js', ['leaf.json'])
  site.esbuildSettings = define('esbuild.settings.js', ['unrelated.json'])
  await index.rebuild(site, reuse)
  define('global.data.js', ['direct.js', 'leaf.json', 'new.json'])
  event('global.data.js')
  await index.rebuild(site, reuse)
  assert.deepEqual(['global.data.js', 'global.vars.js', 'esbuild.settings.js'].map(count), [2, 1, 1])
  assert.ok(index.snapshot().globalDataDepPaths.has(file('new.json').filepath))
  define('global.data.js', ['direct.js', 'replacement.json'])
  define('global.vars.js', ['replacement.json'])
  event('leaf.json')
  await index.rebuild(site, reuse)
  assert.deepEqual(['global.data.js', 'global.vars.js', 'esbuild.settings.js'].map(count), [3, 2, 1])
  assert.ok(!index.snapshot().globalDataDepPaths.has(file('leaf.json').filepath))
  assert.ok(index.snapshot().settingsDepPaths?.has(file('replacement.json').filepath))
})

test('browser-only events invalidate retained analysis even when the page rebuild is skipped', async t => {
  const { index, site, define, file, page, count, event } = fixture(t)
  site.globalData = define('global.data.js')
  site.globalClient = define('global.client.js', ['browser.js'])
  site.pages = [page('home', 'md')]
  await index.rebuild(site, reuse)
  const browserEvent = event('browser.js')
  assert.deepEqual(index.filterEvents([browserEvent], { pageBuildFailed: false }), [browserEvent])
  assert.equal(planWatchEvent({ ...index.snapshot(), siteData: site, pageBuildFailed: false }, browserEvent).kind, 'skip')
  define('global.client.js', ['new-browser.js'])
  assert.equal(count('global.client.js'), 1, 'no index rebuild in the browser-only batch')
  event('home/page.md')
  await index.rebuild(site, reuse)
  assert.equal(count('global.client.js'), 2)
  assert.equal(count('global.data.js'), 1)
  assert.deepEqual(index.snapshot().esbuildDepPaths, new Set([file('new-browser.js').filepath]))
})

test('known nondependent Markdown and HTML changes retain analysis but imported sources evict consumers', async t => {
  const { index, site, define, page, count, event } = fixture(t)
  site.pages = [page('markdown', 'md'), page('html', 'html')]
  site.globalData = define('global.data.js')
  site.globalVars = define('global.vars.js')
  await index.rebuild(site, reuse)
  for (const name of ['markdown/page.md', 'html/page.html']) {
    event(name)
    await index.rebuild(site, reuse)
  }
  assert.deepEqual(['global.data.js', 'global.vars.js', 'markdown/page.md', 'html/page.html'].map(count), [1, 1, 0, 0])
  define('global.data.js', ['markdown/page.md', 'html/page.html'])
  event('global.data.js')
  await index.rebuild(site, reuse)
  for (const name of ['markdown/page.md', 'html/page.html']) {
    event(name)
    await index.rebuild(site, reuse)
  }
  assert.equal(count('global.data.js'), 4)
  assert.equal(count('global.vars.js'), 1)
})

test('filtered unknown changes and structural events clear all retained closures before filtering', async t => {
  const { index, site, define, page, count, event } = fixture(t)
  site.globalData = define('global.data.js')
  site.globalVars = define('global.vars.js')
  site.pages = [page('home', 'md')]
  await index.rebuild(site, reuse)
  const unknown = event('unknown.json')
  assert.deepEqual(index.filterEvents([unknown], { pageBuildFailed: false }), [])
  await index.rebuild(site, reuse)
  assert.deepEqual(['global.data.js', 'global.vars.js'].map(count), [2, 2])
  for (const type of /** @type {const} */ (['added', 'removed'])) {
    event('home/page.md', type)
    await index.rebuild(site, reuse)
  }
  assert.deepEqual(['global.data.js', 'global.vars.js'].map(count), [4, 4])
})

test('current membership prunes removed roots, analyzes new roots and retains successful empty results', async t => {
  const { index, site, define, file, count, event } = fixture(t)
  const first = define('global.data.js', ['old.json'])
  site.globalData = first
  await index.rebuild(site, reuse)
  define('global.data.js')
  event('global.data.js')
  await index.rebuild(site, reuse)
  await index.rebuild(site, reuse)
  assert.equal(count('global.data.js'), 2)
  assert.deepEqual(index.snapshot().globalDataDepPaths, new Set([first.filepath]))
  site.globalVars = define('global.vars.js', ['new.json'])
  await index.rebuild(site, reuse)
  assert.deepEqual(['global.data.js', 'global.vars.js'].map(count), [2, 1])
  site.globalData = undefined
  await index.rebuild(site, reuse)
  assert.equal(index.snapshot().globalDataDepPaths.size, 0)
  site.globalData = first
  await index.rebuild(site, reuse)
  assert.deepEqual(['global.data.js', 'global.vars.js'].map(count), [3, 1])
  assert.ok(index.snapshot().settingsDepPaths?.has(file('new.json').filepath))
  await index.rebuild(emptySite(), reuse)
  for (const value of Object.values(index.snapshot())) {
    if (typeof value !== 'boolean') assert.equal(value.size, 0)
  }
  await index.rebuild(site, reuse)
  assert.deepEqual(['global.data.js', 'global.vars.js'].map(count), [4, 2])
})

test('reused analysis reconstructs current discovery objects and layout selections without changing old snapshots', async t => {
  const { index, site, define, file, page, count } = fixture(t)
  const shared = define('shared.js', ['helper.json'])
  const home = { ...page('home', 'md'), pageVars: shared }
  const template = { templateFile: shared, path: '', outputName: 'old.xml' }
  const owner = { pagesFile: shared, path: '', name: 'old' }
  site.pages = [home]
  site.templates = [template]
  site.pagesFiles = [owner]
  site.layouts['root'] = { ...shared, layoutName: 'root' }
  index.recordLayouts({ pages: [report(home, ['root'])] }, { filtered: false })
  await index.rebuild(site, reuse)
  const before = index.snapshot()
  const currentPage = { ...home, url: '/rediscovered/' }
  const currentTemplate = { ...template, outputName: 'new.xml' }
  const currentOwner = { ...owner, name: 'new' }
  site.pages = [currentPage]
  site.templates = [currentTemplate]
  site.pagesFiles = [currentOwner]
  site.layouts = { child: { ...shared, layoutName: 'child' } }
  index.recordLayouts({ pages: [report(currentPage, ['child'])] }, { filtered: true })
  await index.rebuild(site, reuse)
  const after = index.snapshot()
  const dependency = file('helper.json').filepath
  assert.equal(count('shared.js'), 1)
  assert.equal(after.pageFileMap.get(home.pageFile.filepath), currentPage)
  assert.equal([...after.pageDepMap.get(dependency) ?? []][0], currentPage)
  assert.equal([...after.templateDepMap.get(dependency) ?? []][0], currentTemplate)
  assert.equal([...after.pagesFileDepMap.get(dependency) ?? []][0], currentOwner)
  assert.deepEqual(after.layoutPageMap, new Map([['child', new Set([currentPage])]]))
  assert.deepEqual(after.layoutDepMap.get(dependency), new Set(['child']))
  assert.equal(after.layoutFileMap.get(shared.filepath), 'child')
  assert.equal(before.pageFileMap.get(home.pageFile.filepath), home)
  assert.equal([...before.pageDepMap.get(dependency) ?? []][0], home)
  assert.equal([...before.templateDepMap.get(dependency) ?? []][0], template)
  assert.equal([...before.pagesFileDepMap.get(dependency) ?? []][0], owner)
  assert.deepEqual(before.layoutPageMap, new Map([['root', new Set([home])]]))
  assert.deepEqual(before.layoutDepMap.get(dependency), new Set(['root']))
  assert.equal(before.layoutFileMap.get(shared.filepath), 'root')
})

test('each server role failure forces all roots fresh on recovery, including previously successful roots', async t => {
  for (const role of ['globalData', 'globalVars', 'markdownItSettings', 'esbuildSettings', 'layout', 'page', 'pageVars', 'template', 'pagesFile']) {
    const { index, site, define, graph, page, count } = fixture(t)
    const broken = define('broken.js')
    site.globalClient = define('global.client.js')
    switch (role) {
      case 'globalData': site.globalData = broken; break
      case 'globalVars': site.globalVars = broken; break
      case 'markdownItSettings': site.markdownItSettings = broken; break
      case 'esbuildSettings': site.esbuildSettings = broken; break
      case 'layout': site.layouts['root'] = { ...broken, layoutName: 'root' }; break
      case 'page': site.pages = [{ ...page('home'), pageFile: broken }]; break
      case 'pageVars': site.pages = [{ ...page('home', 'md'), pageVars: broken }]; break
      case 'template': site.templates = [{ templateFile: broken, path: '', outputName: 'feed.xml' }]; break
      case 'pagesFile': site.pagesFiles = [{ pagesFile: broken, path: '', name: 'archive' }]; break
    }
    graph.set(broken.filepath, new Error('analysis failed'))
    await index.rebuild(site, reuse)
    assert.equal(index.snapshot().dependencyAnalysisFailed, true, role)
    define('broken.js', ['recovered.json'])
    await index.rebuild(site, reuse)
    assert.equal(index.snapshot().dependencyAnalysisFailed, false, role)
    assert.deepEqual(['broken.js', 'global.client.js'].map(count), [2, 2], role)
    await index.rebuild(site, reuse)
    assert.deepEqual(['broken.js', 'global.client.js'].map(count), [2, 2], 'successful recovery restores retention')
  }
})

test('shared rejected promises deduplicate per pass while preserving role-specific recovery and logging', async t => {
  const { index, site, define, graph, page, count, debug, event } = fixture(t)
  const shared = define('shared.js')
  site.globalData = shared
  site.globalVars = shared
  site.layouts['root'] = { ...shared, layoutName: 'root' }
  site.pages = [{ ...page('home'), pageFile: shared, pageVars: shared }]
  site.templates = [{ templateFile: shared, path: '', outputName: 'feed.xml' }]
  site.pagesFiles = ['first.pages.js', 'second.pages.js'].map(relname => ({
    pagesFile: { ...shared, relname }, path: '', name: relname,
  }))
  site.globalClient = shared
  graph.set(shared.filepath, new Error('broken shared import'))
  for (let pass = 1; pass <= 2; pass++) {
    await index.rebuild(site, reuse)
    const snapshot = index.snapshot()
    assert.equal(count('shared.js'), pass)
    assert.equal(snapshot.dependencyAnalysisFailed, true)
    assert.deepEqual(snapshot.globalDataDepPaths, new Set([shared.filepath]))
    assert.deepEqual(snapshot.settingsDepPaths, new Set([shared.filepath]))
    assert.deepEqual(snapshot.esbuildEntryPoints, new Set([shared.filepath]))
    assert.equal(snapshot.pageFileMap.get(shared.filepath), site.pages[0])
    assert.equal(snapshot.layoutFileMap.get(shared.filepath), 'root')
    for (const paths of [snapshot.pageDepMap, snapshot.templateDepMap, snapshot.pagesFileDepMap, snapshot.layoutDepMap, snapshot.esbuildDepPaths]) {
      assert.equal(paths?.size, 0)
    }
    assert.equal(debug.mock.callCount(), pass * 2)
    for (const [offset, name] of ['first.pages.js', 'second.pages.js'].entries()) {
      assert.equal(debug.mock.calls[(pass - 1) * 2 + offset]?.arguments[0], `Could not analyze dependencies for pages file "${name}": broken shared import`)
    }
    const events = [event('unknown.json')]
    assert.equal(index.filterEvents(events, { pageBuildFailed: false }), events)
  }
  define('shared.js', ['fixed.json'])
  await index.rebuild(site, reuse)
  await index.rebuild(site, reuse)
  assert.equal(count('shared.js'), 3)
  assert.equal(index.snapshot().dependencyAnalysisFailed, false)
  assert.equal(debug.mock.callCount(), 4)
})

test('browser-only failures retry without discarding successful server or browser analysis', async t => {
  const { index, site, define, graph, count, debug } = fixture(t)
  site.globalData = define('global.data.js')
  site.serviceWorker = define('service-worker.js')
  site.globalClient = define('global.client.js')
  graph.set(site.globalClient.filepath, new Error('browser parse failed'))
  for (let pass = 1; pass <= 2; pass++) {
    await index.rebuild(site, reuse)
    assert.equal(index.snapshot().dependencyAnalysisFailed, false)
    assert.ok(index.snapshot().esbuildEntryPoints.has(site.globalClient.filepath))
    assert.deepEqual(['global.data.js', 'service-worker.js', 'global.client.js'].map(count), [1, 1, pass])
    assert.equal(debug.mock.callCount(), 0)
  }
  define('global.client.js', ['fixed-browser.js'])
  await index.rebuild(site, reuse)
  await index.rebuild(site, reuse)
  assert.deepEqual(['global.data.js', 'service-worker.js', 'global.client.js'].map(count), [1, 1, 3])
})

test('events and explicit clears during awaited observation prevent retention and mark routing uncertain', { timeout: 5000 }, async t => {
  for (const action of ['root', 'source-only', 'unknown', 'structural', 'clear']) {
    const { index, site, define, page, count, event } = fixture(t)
    site.globalData = define('global.data.js', ['helper.json'])
    site.pages = [page('home', 'md')]
    const entered = Promise.withResolvers()
    const release = Promise.withResolvers()
    t.after(() => release.resolve(undefined))
    let block = false
    const isObserved = async () => {
      if (block) {
        entered.resolve(undefined)
        await release.promise
      }
      return true
    }
    const options = { reuseAnalysis: true, isObserved }
    await index.rebuild(site, options)
    const before = index.snapshot()
    index.clearAnalysis()
    assert.equal(index.snapshot().pageFileMap, before.pageFileMap, 'clearAnalysis preserves recovery routing')
    block = true
    const pending = index.rebuild(site, options)
    await entered.promise
    switch (action) {
      case 'root': event('global.data.js'); break
      case 'source-only': event('home/page.md'); break
      case 'unknown': event('unknown.json'); break
      case 'structural': event('home/page.md', 'added'); break
      case 'clear': index.clearAnalysis(); break
    }
    release.resolve(undefined)
    await pending
    assert.equal(index.snapshot().dependencyAnalysisFailed, true, action)
    assert.deepEqual(index.snapshot().globalDataDepPaths, before.globalDataDepPaths, 'uncertain routing remains available for recovery')
    assert.equal(before.dependencyAnalysisFailed, false, 'old snapshot remains unchanged')
    block = false
    await index.rebuild(site, options)
    await index.rebuild(site, options)
    assert.equal(count('global.data.js'), 3, action)
    assert.equal(index.snapshot().dependencyAnalysisFailed, false)
  }
})

test('an overlapping newer rebuild owns routing and retention after the older finder completes', { timeout: 5000 }, async t => {
  const { index, site, define, file, graph, count } = fixture(t)
  site.globalData = define('global.data.js', ['initial.json'])
  await index.rebuild(site, reuse)
  index.clearAnalysis()
  const entered = Promise.withResolvers()
  const release = Promise.withResolvers()
  t.after(() => release.resolve(undefined))
  graph.set(site.globalData.filepath, async () => {
    entered.resolve(undefined)
    await release.promise
    return [file('stale.json').filepath]
  })
  const older = index.rebuild(site, reuse)
  await entered.promise
  define('global.data.js', ['current.json'])
  const newerSite = { ...site, globalVars: define('global.vars.js', ['settings.json']) }
  await index.rebuild(newerSite, reuse)
  const current = index.snapshot()
  release.resolve(undefined)
  await older
  assert.equal(index.snapshot().globalDataDepPaths, current.globalDataDepPaths)
  assert.equal(index.snapshot().settingsDepPaths, current.settingsDepPaths)
  assert.deepEqual(current.globalDataDepPaths, new Set([site.globalData.filepath, file('current.json').filepath]))
  assert.ok(current.settingsDepPaths?.has(file('settings.json').filepath))
  assert.equal(current.dependencyAnalysisFailed, false)
  await index.rebuild(newerSite, reuse)
  assert.deepEqual(['global.data.js', 'global.vars.js'].map(count), [3, 1], 'stale completion cannot replace or clear the newer retained analysis')
  assert.deepEqual(index.snapshot().globalDataDepPaths, current.globalDataDepPaths)
})

// Top-level tests run sequentially in node --test's isolated file process.
test('a CWD change between reused rebuilds refreshes every root and resolves inputs against the new CWD', async t => {
  const cwd = process.cwd()
  const nextDirectory = await mkdtemp(join(tmpdir(), 'domstack-analysis-cwd-'))
  t.after(async () => {
    process.chdir(cwd)
    await rm(nextDirectory, { recursive: true, force: true })
  })
  const { index, site, define, graph, count } = fixture(t)
  site.globalData = define('global.data.js')
  site.globalVars = define('global.vars.js')
  graph.set(site.globalData.filepath, ['helper.json'])
  graph.set(site.globalVars.filepath, ['settings.json'])
  await index.rebuild(site, reuse)
  await index.rebuild(site, reuse)
  assert.deepEqual(['global.data.js', 'global.vars.js'].map(count), [1, 1])
  const before = index.snapshot()

  process.chdir(nextDirectory)
  const nextCwd = process.cwd()
  await index.rebuild(site, reuse)
  assert.deepEqual(['global.data.js', 'global.vars.js'].map(count), [2, 2], 'unchanged absolute roots still require fresh analysis after chdir')
  const after = index.snapshot()
  assert.deepEqual(after.globalDataDepPaths, new Set([site.globalData.filepath, join(nextCwd, 'helper.json')]))
  assert.deepEqual(after.settingsDepPaths, new Set([site.globalVars.filepath, join(nextCwd, 'settings.json')]))
  assert.equal(after.dependencyAnalysisFailed, false)
  assert.deepEqual(before.globalDataDepPaths, new Set([site.globalData.filepath, join(cwd, 'helper.json')]))
  assert.deepEqual(before.settingsDepPaths, new Set([site.globalVars.filepath, join(cwd, 'settings.json')]))

  await index.rebuild(site, reuse)
  assert.deepEqual(['global.data.js', 'global.vars.js'].map(count), [2, 2], 'the new CWD baseline permits reuse')
  assert.deepEqual(index.snapshot().globalDataDepPaths, after.globalDataDepPaths)
  assert.deepEqual(index.snapshot().settingsDepPaths, after.settingsDepPaths)
})

test('a CWD change while the finder is pending prevents retention until fresh recovery in the new CWD', { timeout: 5000 }, async t => {
  const cwd = process.cwd()
  const nextDirectory = await mkdtemp(join(tmpdir(), 'domstack-analysis-cwd-race-'))
  const entered = Promise.withResolvers()
  const release = Promise.withResolvers()
  let pending = Promise.resolve()
  t.after(async () => {
    release.resolve(undefined)
    try {
      await pending
    } finally {
      process.chdir(cwd)
      await rm(nextDirectory, { recursive: true, force: true })
    }
  })
  const { index, site, define, graph, count, event } = fixture(t)
  site.globalData = define('global.data.js')
  site.globalVars = define('global.vars.js')
  graph.set(site.globalData.filepath, ['helper.json'])
  graph.set(site.globalVars.filepath, ['settings.json'])
  await index.rebuild(site, reuse)
  const before = index.snapshot()
  event('global.data.js')
  graph.set(site.globalData.filepath, async () => {
    entered.resolve(undefined)
    await release.promise
    return ['pending.json']
  })
  pending = index.rebuild(site, reuse)
  await entered.promise
  process.chdir(nextDirectory)
  const nextCwd = process.cwd()
  release.resolve(undefined)
  await pending

  const uncertain = index.snapshot()
  assert.equal(uncertain.dependencyAnalysisFailed, true)
  assert.deepEqual(uncertain.globalDataDepPaths, new Set([site.globalData.filepath, join(cwd, 'pending.json')]), 'in-flight results resolve against the captured CWD')
  assert.deepEqual(['global.data.js', 'global.vars.js'].map(count), [2, 1])
  assert.deepEqual(uncertain.settingsDepPaths, before.settingsDepPaths, 'previous routing remains available while analysis is uncertain')

  graph.set(site.globalData.filepath, ['recovered.json'])
  await index.rebuild(site, reuse)
  const recovered = index.snapshot()
  assert.equal(recovered.dependencyAnalysisFailed, false)
  assert.deepEqual(['global.data.js', 'global.vars.js'].map(count), [3, 2], 'recovery refreshes both pending and previously retained analysis')
  assert.deepEqual(recovered.globalDataDepPaths, new Set([site.globalData.filepath, join(nextCwd, 'recovered.json')]))
  assert.deepEqual(recovered.settingsDepPaths, new Set([site.globalVars.filepath, join(nextCwd, 'settings.json')]))
  await index.rebuild(site, reuse)
  assert.deepEqual(['global.data.js', 'global.vars.js'].map(count), [3, 2])
  assert.deepEqual(index.snapshot().globalDataDepPaths, recovered.globalDataDepPaths)
  assert.equal(uncertain.dependencyAnalysisFailed, true, 'recovery does not mutate the uncertain snapshot')
  assert.deepEqual(before.globalDataDepPaths, new Set([site.globalData.filepath, join(cwd, 'helper.json')]))
  assert.equal(before.dependencyAnalysisFailed, false)
})
