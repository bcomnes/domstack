/**
 * @import { WatchSnapshot, WatchPlan } from './watch-plan.js'
 * @import { WalkerFile, PageInfo, PageTypes } from './identify-pages.js'
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { basename, dirname, join, resolve } from 'node:path'
import { classifyWatchEvent, planWatchEvent, planWatchBatch, planBundleChange } from './watch-plan.js'

const src = '/site'

/** @param {string} relname @returns {WalkerFile} */
function file (relname) {
  return { root: src, filepath: join(src, relname), relname, basename: basename(relname), parentName: dirname(relname) }
}

/** @param {string} path @param {PageTypes} [type] @returns {PageInfo} */
function page (path, type = 'md') {
  return { pageFile: file(join(path, `page.${type}`)), type, path, url: `/${path}/`, outputName: 'index.html', outputRelname: join(path, 'index.html'), draft: false }
}

function fixture () {
  const home = page('')
  const other = page('other', 'js')
  const template = { templateFile: file('feed.template.js'), path: '', outputName: 'feed.xml' }
  const owner = { pagesFile: file('archive.pages.js'), path: '', name: 'archive' }
  const root = { ...file('root.layout.js'), layoutName: 'root', layoutStyle: file('root.layout.css') }
  const state = /** @satisfies {WatchSnapshot} */ ({
    siteData: { pages: [home, other], templates: [template], pagesFiles: [owner], layouts: { root } },
    layoutDepMap: new Map([['/site/layout-helper.js', new Set(['root'])]]),
    layoutPageMap: new Map([['root', new Set([home])]]),
    pageFileMap: new Map([[home.pageFile.filepath, home], ['/site/page.vars.js', home]]),
    layoutFileMap: new Map([[root.filepath, 'root']]),
    pageDepMap: new Map([['/site/page-helper.js', new Set([other])]]),
    templateDepMap: new Map([['/site/template-helper.js', new Set([template])]]),
    pagesFileDepMap: new Map([['/site/archive-helper.js', new Set([owner])]]),
    pagesFileLayoutMap: new Map([[owner.pagesFile.filepath, new Set(['root'])]]),
    globalDataDepPaths: new Set(['/site/global.data.js']),
    globalVarsDepPaths: new Set(),
    markdownDepPaths: new Set(),
    dependencyAnalysisFailed: false,
    pageBuildFailed: false,
    esbuildEntryPoints: new Set(['/site/client.jsx', '/site/root.layout.css']),
    esbuildDepPaths: new Set(),
  })
  return { state, home, other, template, owner }
}

/** @param {WatchPlan} plan */
function scope (plan) {
  assert.equal(plan.kind, 'pages')
  if (plan.kind !== 'pages') throw new Error('Expected a page plan')
  return [plan.pageFilterPaths, plan.templateFilterPaths, plan.pagesFileFilterPaths]
}

test('settings and untracked changes produce inspectable full, page, and skip plans', () => {
  const { state, home } = fixture()
  for (const name of ['global.vars.js', 'esbuild.settings.js']) {
    assert.equal(planWatchEvent(state, classifyWatchEvent('change', `/site/${name}`)).kind, 'full')
  }
  assert.deepEqual(scope(planWatchEvent(state, classifyWatchEvent('change', '/site/global.data.js'))), [[], [], []])
  assert.deepEqual(scope(planWatchEvent(state, classifyWatchEvent('change', '/site/markdown-it.settings.js'))), [[home.pageFile.filepath], [], []])
  for (const [name, reason] of [['domstack-manifest.settings.js', 'disabled'], ['client.jsx', 'esbuild'], ['unused.js', 'did not match']]) {
    const plan = planWatchEvent(state, classifyWatchEvent('change', `/site/${name}`))
    assert.equal(plan.kind, 'skip')
    assert.ok(plan.message?.includes(reason ?? ''))
  }
})

test('layout maps target source pages and generated-page owners', () => {
  const { state, home, owner } = fixture()
  for (const name of ['root.layout.js', 'layout-helper.js']) {
    const plan = planWatchEvent(state, classifyWatchEvent('change', `/site/${name}`))
    assert.deepEqual(scope(plan), [[home.pageFile.filepath], [], [owner.pagesFile.filepath]])
  }
  state.layoutPageMap.clear()
  assert.deepEqual(scope(planWatchEvent(state, classifyWatchEvent('change', '/site/root.layout.js'))), [[], [], [owner.pagesFile.filepath]])
  state.pagesFileLayoutMap.clear()
  const unused = planWatchEvent(state, classifyWatchEvent('change', '/site/root.layout.js'))
  assert.equal(unused.kind, 'skip')
  assert.ok(unused.message?.includes('did not match any rebuild rule'))
})

test('events without affected layouts do not scan generated-page layout memberships', t => {
  const { state } = fixture()
  const scan = t.mock.method(state.pagesFileLayoutMap, Symbol.iterator)
  for (const name of ['page.md', 'page-helper.js', 'template-helper.js', 'client.jsx']) {
    planWatchEvent(state, classifyWatchEvent('change', `/site/${name}`))
  }
  assert.equal(scan.mock.callCount(), 0)
  planWatchEvent(state, classifyWatchEvent('change', '/site/layout-helper.js'))
  assert.equal(scan.mock.callCount(), 1)
})

test('page, template, and owner inputs retain their targeted scopes', () => {
  const { state, home, other, owner, template } = fixture()
  const cases = [
    ['page.md', [home.pageFile.filepath], [], []],
    ['page.vars.js', [home.pageFile.filepath], [], []],
    ['page-helper.js', [other.pageFile.filepath], [], []],
    ['archive.pages.js', [], [], [owner.pagesFile.filepath]],
    ['archive-helper.js', [], [], [owner.pagesFile.filepath]],
    ['feed.template.js', [], [template.templateFile.filepath], []],
    ['template-helper.js', [], [template.templateFile.filepath], []],
  ]
  for (const [name, ...expected] of cases) {
    assert.deepEqual(scope(planWatchEvent(state, classifyWatchEvent('change', `/site/${name}`))), expected)
  }
})

test('planning unions every shared role, deduplicates consumers, and leaves the snapshot untouched', () => {
  const { state, home, other, template, owner } = fixture()
  state.layoutDepMap.set('/site/shared.js', new Set(['root', 'another']))
  state.layoutPageMap.set('another', new Set([home]))
  state.pageDepMap.set('/site/shared.js', new Set(state.siteData.pages))
  state.templateDepMap.set('/site/shared.js', new Set([template]))
  state.pagesFileDepMap.set('/site/shared.js', new Set([owner]))
  state.globalDataDepPaths.add('/site/shared.js')
  state.esbuildEntryPoints.add('/site/shared.js')
  const before = structuredClone(state)
  const event = classifyWatchEvent('change', '/site/shared.js')
  const first = planWatchEvent(state, event)
  assert.deepEqual(scope(first), [[home.pageFile.filepath, other.pageFile.filepath], [template.templateFile.filepath], [owner.pagesFile.filepath]])
  assert.ok(first.message?.includes('rebuilding data subscribers'))
  assert.deepEqual(planWatchEvent(state, event), first)
  assert.deepEqual(state, before)
})

test('global-data-only imports trigger subscriber builds even when they are browser entries', () => {
  for (const name of ['data-helper.js', 'client.jsx']) {
    const { state } = fixture()
    const filepath = `/site/${name}`
    state.globalDataDepPaths.add(filepath)
    const plan = planWatchEvent(state, classifyWatchEvent('change', filepath))
    assert.deepEqual(scope(plan), [[], [], []], 'recompute data without directly selecting unrelated consumers')
    assert.ok(plan.message?.includes('rebuilding data subscribers'))
  }
})

test('a directly selected layout also rebuilds layouts that import it', () => {
  const { state, home, other, owner } = fixture()
  state.layoutDepMap.set('/site/root.layout.js', new Set(['child']))
  state.layoutPageMap.set('child', new Set([other]))
  const plan = planWatchEvent(state, classifyWatchEvent('change', '/site/root.layout.js'))
  assert.deepEqual(scope(plan), [[other.pageFile.filepath, home.pageFile.filepath], [], [owner.pagesFile.filepath]])
})

test('failed page builds retry fully before incomplete maps or browser entries can skip the work', () => {
  const { state } = fixture()
  const failed = { ...state, pageBuildFailed: true }
  for (const name of ['unused.js', 'client.jsx', 'root.layout.js', 'global.data.js', 'markdown-it.settings.js']) {
    const plan = planWatchEvent(failed, classifyWatchEvent('change', `/site/${name}`))
    assert.deepEqual(scope(plan), [null, null, null])
    assert.ok(plan.message?.includes('retrying all pages after the previous build failure'))
  }
  assert.equal(planWatchEvent(failed, classifyWatchEvent('change', '/site/global.vars.js')).kind, 'full')
  assert.equal(planWatchEvent(failed, classifyWatchEvent('change', '/site/domstack-manifest.settings.js')).kind, 'skip')
})

test('structural events distinguish esbuild entries from full rediscovery', () => {
  const { state } = fixture()
  for (const type of /** @type {const} */ (['added', 'removed'])) {
    for (const name of ['client.jsx', 'client.tsx', 'style.css', 'task.worker.js', 'root.layout.client.tsx', 'root.layout.css', 'global.client.js', 'global.css', 'service-worker.js']) {
      assert.equal(planWatchEvent(state, classifyWatchEvent(type, `/site/${name}`)).kind, 'restart', name)
    }
    for (const name of ['page.md', 'root.layout.js', 'archive.pages.js', 'global.data.js', 'dependency.js']) {
      assert.equal(planWatchEvent(state, classifyWatchEvent(type, `/site/${name}`)).kind, 'full', name)
    }
  }
})

test('bundle plans cover page, global, layout, removed-layout fallback, and service-worker scopes', () => {
  const { state, home, owner } = fixture()
  const plan = (/** @type {string} */ name) => planBundleChange(state, classifyWatchEvent('added', `/site/${name}`), src)
  assert.deepEqual(scope(plan('client.jsx')), [[home.pageFile.filepath], [], []])
  assert.deepEqual(scope(plan('global.css')), [null, null, null])
  assert.deepEqual(scope(plan('root.layout.css')), [[home.pageFile.filepath], [], [owner.pagesFile.filepath]])
  assert.deepEqual(scope(plan('removed.layout.css')), [null, [], null])
  assert.deepEqual(scope(plan('missing/client.js')), [null, null, null])
  assert.equal(plan('service-worker.js').kind, 'skip')
})

test('bundle plans retry the full page phase after failure but preserve service-worker skips', () => {
  const { state } = fixture()
  const failed = { ...state, pageBuildFailed: true }
  const before = structuredClone(failed)
  for (const type of /** @type {const} */ (['added', 'removed'])) {
    for (const name of ['client.jsx', 'style.css', 'task.worker.js', 'root.layout.css', 'removed.layout.css', 'global.css', 'missing/client.js']) {
      const event = classifyWatchEvent(type, `/site/${name}`)
      assert.equal(planWatchEvent(failed, event).kind, 'restart', 'entry changes still restart esbuild first')
      assert.deepEqual(planBundleChange(failed, event, src), {
        kind: 'pages',
        pageFilterPaths: null,
        templateFilterPaths: null,
        pagesFileFilterPaths: null,
        message: `"${basename(name)}" ${type}, retrying all pages after the previous build failure...`,
      })
    }
    const event = classifyWatchEvent(type, '/site/service-worker.js')
    assert.equal(planWatchEvent(failed, event).kind, 'restart')
    assert.equal(planBundleChange(failed, event, src).kind, 'skip')
  }
  assert.deepEqual(failed, before)
})

test('classification resolves paths without changing the public event shape', () => {
  const event = classifyWatchEvent('added', './nested/../page.md')
  assert.deepEqual(event, {
    type: 'added',
    filepath: resolve('page.md'),
    name: 'page.md',
    convention: classifyWatchEvent('change', '/site/page.md').convention,
  })
  assert.equal(classifyWatchEvent('change', '/site/nested/../page.md').filepath, '/site/page.md')
})

test('snapshots without optional dependency analysis fields remain compatible', () => {
  const { state, home } = fixture()
  const { globalVarsDepPaths, markdownDepPaths, dependencyAnalysisFailed, esbuildDepPaths, ...legacy } = state
  assert.deepEqual(scope(planWatchEvent(legacy, classifyWatchEvent('change', '/site/page.md'))), [[home.pageFile.filepath], [], []])
  assert.equal(planWatchBatch(legacy, [classifyWatchEvent('change', '/site/page.md')]).inputChanges.resetReason, undefined)
  assert.equal(planWatchBatch(legacy, [classifyWatchEvent('change', '/site/unknown.js')]).inputChanges.resetReason, 'unknown-event')
})

test('markdown roots and imports union server roles before browser or manifest skips', () => {
  for (const name of ['markdown-it.settings.js', 'markdown-helper.js', 'client.jsx', 'domstack-manifest.settings.js']) {
    const { state, home, other, template, owner } = fixture()
    const filepath = `/site/${name}`
    if (name !== 'markdown-it.settings.js') state.markdownDepPaths.add(filepath)
    state.pageDepMap.set(filepath, new Set([other]))
    state.layoutDepMap.set(filepath, new Set(['root']))
    state.templateDepMap.set(filepath, new Set([template]))
    state.pagesFileDepMap.set(filepath, new Set([owner]))
    state.esbuildEntryPoints.add(filepath)
    const event = classifyWatchEvent('change', filepath)
    assert.deepEqual(scope(planWatchEvent(state, event)), [[other.pageFile.filepath, home.pageFile.filepath], [template.templateFile.filepath], [owner.pagesFile.filepath]], name)
    const batch = planWatchBatch(state, [event])
    assert.deepEqual(scope(batch.plan), scope(planWatchEvent(state, event)))
    assert.equal(batch.inputChanges.resetReason, 'markdown-settings-changed')
  }
})

test('global vars imports dominate every shared role and global data roots need no map entry', () => {
  for (const name of ['vars-helper.js', 'client.jsx', 'markdown-it.settings.js', 'domstack-manifest.settings.js']) {
    const { state, other } = fixture()
    const filepath = `/site/${name}`
    state.globalVarsDepPaths.add(filepath)
    state.markdownDepPaths.add(filepath)
    state.pageDepMap.set(filepath, new Set([other]))
    const event = classifyWatchEvent('change', filepath)
    assert.equal(planWatchEvent(state, event).kind, 'full', name)
    assert.equal(planWatchBatch(state, [event]).inputChanges.resetReason, 'global-vars-changed', name)
  }
  const { state } = fixture()
  state.globalDataDepPaths.clear()
  assert.deepEqual(scope(planWatchEvent(state, classifyWatchEvent('change', '/site/global.data.js'))), [[], [], []])
  state.siteData.pages = []
  assert.deepEqual(scope(planWatchEvent(state, classifyWatchEvent('change', '/site/markdown-it.settings.js'))), [[], [], []])
})

test('manifest settings imported by server consumers do not hide those roles', () => {
  const { state, other } = fixture()
  const filepath = '/site/domstack-manifest.settings.js'
  state.pageDepMap.set(filepath, new Set([other]))
  state.globalDataDepPaths.add(filepath)
  const event = classifyWatchEvent('change', filepath)
  assert.deepEqual(scope(planWatchEvent(state, event)), [[other.pageFile.filepath], [], []])
  assert.equal(planWatchBatch(state, [event]).inputChanges.resetReason, 'global-data-changed')
})

test('batch unions filtered output scopes and source inputs, retaining event order and duplicates', () => {
  const { state, home, other, template, owner } = fixture()
  const events = ['page-helper.js', 'layout-helper.js', 'template-helper.js', 'archive-helper.js', 'page.md', 'client.jsx', 'page-helper.js']
    .map(name => classifyWatchEvent('change', `/site/${name}`))
  const before = structuredClone({ state, events })
  events.forEach(Object.freeze)
  Object.freeze(events)
  const batch = planWatchBatch(state, events)
  assert.deepEqual(scope(batch.plan), [[other.pageFile.filepath, home.pageFile.filepath], [template.templateFile.filepath], [owner.pagesFile.filepath]])
  assert.equal(batch.plan.kind, 'pages')
  if (batch.plan.kind !== 'pages') throw new Error('Expected a page plan')
  assert.deepEqual(batch.plan.pages, [other, home])
  assert.deepEqual(batch.plan.templates, [template])
  assert.equal(batch.plan.message, undefined, 'browser skip messages do not replace rebuild logging')
  assert.deepEqual(batch.inputChanges, {
    upsertedPaths: [other.pageFile.filepath, home.pageFile.filepath],
    events,
  })
  assert.notEqual(batch.inputChanges.events, events)
  assert.deepEqual(planWatchBatch(state, events), batch)
  assert.deepEqual({ state, events }, before)
})

test('single page plans preserve exact logging metadata and messages even when surrounded by skips', () => {
  const { state } = fixture()
  const skipped = classifyWatchEvent('change', '/site/client.jsx')
  for (const name of ['page.md', 'layout-helper.js', 'feed.template.js', 'global.data.js', 'markdown-it.settings.js']) {
    const event = classifyWatchEvent('change', `/site/${name}`)
    const expected = planWatchEvent(state, event)
    assert.equal(expected.kind, 'pages')
    for (const events of [[event], [skipped, event], [event, skipped], [skipped, event, skipped]]) {
      assert.deepEqual(planWatchBatch(state, events).plan, expected, name)
    }
    const failed = { ...state, pageBuildFailed: true }
    assert.deepEqual(planWatchBatch(failed, [event]).plan, planWatchEvent(failed, event), 'recovery preserves the single-event message')
  }
})

test('page-plan unions retain distinct messages in event order without duplicate lines', () => {
  const { state, home, template } = fixture()
  state.globalDataDepPaths.add('/site/data-helper.js')
  const data = classifyWatchEvent('change', '/site/global.data.js')
  const helper = classifyWatchEvent('change', '/site/data-helper.js')
  const pageEvent = classifyWatchEvent('change', home.pageFile.filepath)
  const templateEvent = classifyWatchEvent('change', template.templateFile.filepath)
  for (const [first, second] of [[data, helper], [helper, data]]) {
    assert.ok(first && second)
    const batch = planWatchBatch(state, [first, pageEvent, second, templateEvent, first, second])
    assert.equal(batch.plan.kind, 'pages')
    if (batch.plan.kind !== 'pages') throw new Error('Expected a page plan')
    assert.deepEqual(batch.plan.pages, [home])
    assert.deepEqual(batch.plan.templates, [template])
    assert.equal(batch.plan.message, [planWatchEvent(state, first).message, planWatchEvent(state, second).message].join('\n'))
  }
})

test('known browser-only dependencies skip page rebuilding in both planners without resetting inputs', () => {
  const { state } = fixture()
  for (const filepath of ['/site/browser-helper.js', '/site/nested/client.js']) {
    state.esbuildDepPaths.add(filepath)
    assert.equal(state.esbuildEntryPoints.has(filepath), false)
    const event = classifyWatchEvent('change', filepath)
    const single = planWatchEvent(state, event)
    assert.equal(single.kind, 'skip')
    assert.ok(single.message?.includes('esbuild will handle rebundling'))
    const batch = planWatchBatch(state, [event])
    assert.deepEqual(batch.plan, single)
    assert.deepEqual(batch.inputChanges, { upsertedPaths: [], events: [event] })
  }
  const unknown = planWatchBatch(state, [classifyWatchEvent('change', '/site/unknown.js')])
  assert.equal(unknown.plan.kind, 'full')
  assert.equal(unknown.inputChanges.resetReason, 'unknown-event')
})

test('browser dependency membership cannot hide mapped server consumers or global reset reasons', () => {
  const { state } = fixture()
  state.globalDataDepPaths.add('/site/data-helper.js')
  state.markdownDepPaths.add('/site/markdown-helper.js')
  state.globalVarsDepPaths.add('/site/vars-helper.js')
  for (const name of ['page.md', 'page.vars.js', 'root.layout.js', 'layout-helper.js', 'page-helper.js', 'template-helper.js', 'archive-helper.js', 'data-helper.js', 'markdown-helper.js', 'vars-helper.js']) {
    const filepath = `/site/${name}`
    const event = classifyWatchEvent('change', filepath)
    const single = planWatchEvent(state, event)
    const batch = planWatchBatch(state, [event])
    assert.notEqual(single.kind, 'skip', name)
    state.esbuildDepPaths.add(filepath)
    assert.deepEqual(planWatchEvent(state, event), single, name)
    assert.deepEqual(planWatchBatch(state, [event]), batch, name)
  }
})

test('known browser dependencies do not suppress recovery after build or dependency-analysis failures', () => {
  const { state } = fixture()
  const event = classifyWatchEvent('change', '/site/browser-helper.js')
  state.esbuildDepPaths.add(event.filepath)
  for (const flag of /** @type {const} */ (['pageBuildFailed', 'dependencyAnalysisFailed'])) {
    const batch = planWatchBatch({ ...state, [flag]: true }, [event])
    assert.deepEqual(scope(batch.plan), [null, null, null])
    assert.equal(batch.inputChanges.resetReason, flag === 'pageBuildFailed' ? 'page-build-failed' : 'dependency-analysis-failed')
  }
})

test('template and generated-page owner changes do not invent source inputs', () => {
  const { state, template, owner } = fixture()
  const batch = planWatchBatch(state, ['feed.template.js', 'archive.pages.js', 'archive-helper.js']
    .map(name => classifyWatchEvent('change', `/site/${name}`)))
  assert.deepEqual(scope(batch.plan), [[], [template.templateFile.filepath], [owner.pagesFile.filepath]])
  assert.deepEqual(batch.inputChanges.upsertedPaths, [])
  assert.equal(batch.inputChanges.resetReason, undefined)
})

test('null filters dominate filtered scopes and failure resets override event reasons', () => {
  for (const flag of /** @type {const} */ (['pageBuildFailed', 'dependencyAnalysisFailed'])) {
    const { state: snapshot } = fixture()
    const state = { ...snapshot, pageBuildFailed: flag === 'pageBuildFailed', dependencyAnalysisFailed: flag === 'dependencyAnalysisFailed' }
    const events = ['page.md', 'feed.template.js', 'global.data.js'].map(name => classifyWatchEvent('change', `/site/${name}`))
    const batch = planWatchBatch(state, events)
    assert.deepEqual(scope(batch.plan), [null, null, null])
    assert.equal(batch.inputChanges.resetReason, flag === 'pageBuildFailed' ? 'page-build-failed' : 'dependency-analysis-failed')
    const skipped = planWatchBatch(state, [classifyWatchEvent('change', '/site/domstack-manifest.settings.js')])
    assert.deepEqual(scope(skipped.plan), [null, null, null], 'a nonempty recovery batch cannot skip')
    state.pageBuildFailed = state.dependencyAnalysisFailed = true
    assert.equal(planWatchBatch(state, events).inputChanges.resetReason, 'page-build-failed')
  }
})

test('empty and intentionally skipped batches have no input changes', () => {
  const { state } = fixture()
  for (const events of [[], ['client.jsx', 'domstack-manifest.settings.js'].map(name => classifyWatchEvent('change', `/site/${name}`))]) {
    const batch = planWatchBatch(state, events)
    assert.equal(batch.plan.kind, 'skip')
    assert.deepEqual(batch.inputChanges, { upsertedPaths: [], events })
  }
  const failed = { ...state, pageBuildFailed: true, dependencyAnalysisFailed: true }
  assert.deepEqual(planWatchBatch(failed, []).inputChanges, { upsertedPaths: [], events: [] })
  assert.equal(planWatchBatch(failed, []).plan.kind, 'skip')
})

test('structural source pages carry membership candidates and change-plan consumers without resetting', () => {
  for (const type of /** @type {const} */ (['added', 'removed'])) {
    for (const name of ['page.md', 'new/page.html', 'new/page.js', 'new/page.draft.mjs', 'new/README.md', 'new/README.draft.md', 'new/post.md', 'new/post.draft.md']) {
      const { state, home, other } = fixture()
      const filepath = `/site/${name}`
      state.pageDepMap.set(filepath, new Set([other]))
      const event = classifyWatchEvent(type, filepath)
      const batch = planWatchBatch(state, [event])
      assert.equal(batch.plan.kind, 'full', 'rediscovery is required')
      const expected = [other.pageFile.filepath]
      if (name === 'page.md') expected.push(home.pageFile.filepath)
      expected.push(filepath)
      assert.deepEqual(batch.inputChanges, { upsertedPaths: [...new Set(expected)], events: [event] }, `${type} ${name}`)
    }
  }
})

test('structural events preserve replacement and removal order for membership reconciliation', () => {
  const { state } = fixture()
  const events = [
    classifyWatchEvent('removed', '/site/page.md'),
    classifyWatchEvent('added', '/site/page.html'),
    classifyWatchEvent('added', '/site/new/post.md'),
    classifyWatchEvent('removed', '/site/new/post.md'),
  ]
  const batch = planWatchBatch(state, events)
  assert.equal(batch.plan.kind, 'full')
  assert.deepEqual(batch.inputChanges, { upsertedPaths: ['/site/page.md', '/site/page.html', '/site/new/post.md'], events })
})

test('structural layout, vars, unknown, template, and owner events conservatively upsert only source pages', () => {
  for (const type of /** @type {const} */ (['added', 'removed'])) {
    for (const name of ['page.vars.js', 'new/page.vars.mjs', 'root.layout.js', 'new.layout.js', 'helper.js', 'feed.template.js', 'archive.pages.js']) {
      const { state, home, other, owner } = fixture()
      state.siteData.pages.push({ ...page('generated'), generated: { pagesFile: owner } })
      const event = classifyWatchEvent(type, `/site/${name}`)
      const batch = planWatchBatch(state, [event])
      assert.equal(batch.plan.kind, 'full')
      assert.deepEqual(batch.inputChanges, { upsertedPaths: [home.pageFile.filepath, other.pageFile.filepath], events: [event] }, `${type} ${name}`)
    }
  }
})

test('non-source structural events do not resolve individual page consumers', t => {
  const { state, home, other } = fixture()
  const lookup = t.mock.method(state.pageDepMap, 'get')
  for (const type of /** @type {const} */ (['added', 'removed'])) {
    for (const name of ['page.vars.js', 'root.layout.js', 'feed.template.js', 'archive.pages.js', 'helper.js', 'client.jsx']) {
      const batch = planWatchBatch(state, [classifyWatchEvent(type, `/site/${name}`)])
      assert.deepEqual(batch.inputChanges.upsertedPaths, [home.pageFile.filepath, other.pageFile.filepath])
    }
  }
  assert.equal(lookup.mock.callCount(), 0)
  const batch = planWatchBatch(state, [classifyWatchEvent('added', '/site/new/page.md')])
  assert.deepEqual(batch.inputChanges.upsertedPaths, ['/site/new/page.md'])
  assert.equal(lookup.mock.callCount(), 1, 'structural source events still resolve mapped consumers')
})

test('repeated all-source events preserve candidate order and later membership changes', () => {
  const { state, home, other } = fixture()
  const events = [
    classifyWatchEvent('change', '/site/page-helper.js'),
    classifyWatchEvent('added', '/site/first/post.md'),
    classifyWatchEvent('added', '/site/feed.template.js'),
    classifyWatchEvent('removed', '/site/root.layout.js'),
    classifyWatchEvent('added', '/site/second/post.md'),
    classifyWatchEvent('change', '/site/global.vars.js'),
    classifyWatchEvent('removed', '/site/first/post.md'),
  ]
  const before = structuredClone(state)
  const batch = planWatchBatch(state, events)
  assert.equal(batch.plan.kind, 'full')
  assert.deepEqual(batch.inputChanges, {
    upsertedPaths: [other.pageFile.filepath, '/site/first/post.md', home.pageFile.filepath, '/site/second/post.md'],
    resetReason: 'global-vars-changed',
    events,
  })
  assert.deepEqual(state, before)
})

test('batch bundle restarts become full without resetting, including when mixed with page or full plans', () => {
  for (const name of ['client.jsx', 'root.layout.css', 'global.css', 'service-worker.js']) {
    const { state, home, other } = fixture()
    const restart = classifyWatchEvent('removed', `/site/${name}`)
    assert.equal(planWatchEvent(state, restart).kind, 'restart')
    for (const events of [[restart], [restart, classifyWatchEvent('change', '/site/page.md')], [classifyWatchEvent('added', '/site/new/page.md'), restart], [restart, classifyWatchEvent('added', '/site/new/page.md')]]) {
      const batch = planWatchBatch(state, events)
      assert.equal(batch.plan.kind, 'full')
      assert.equal(batch.inputChanges.resetReason, undefined)
      assert.ok(batch.inputChanges.upsertedPaths.includes(home.pageFile.filepath))
      assert.ok(batch.inputChanges.upsertedPaths.includes(other.pageFile.filepath))
    }
  }
})

test('global roots and imports reset on changes, additions, and removals regardless of shared roles', () => {
  const cases = /** @type {const} */ ([
    ['global.data.js', 'globalDataDepPaths', 'global-data-changed'],
    ['global.vars.js', 'globalVarsDepPaths', 'global-vars-changed'],
    ['markdown-it.settings.js', 'markdownDepPaths', 'markdown-settings-changed'],
    ['esbuild.settings.js', null, 'global-config-changed'],
  ])
  for (const type of /** @type {const} */ (['change', 'added', 'removed'])) {
    for (const [name, depSet, reason] of cases) {
      const { state, other } = fixture()
      state.globalDataDepPaths.clear()
      const root = classifyWatchEvent(type, `/site/${name}`)
      assert.equal(planWatchBatch(state, [root]).inputChanges.resetReason, reason, `${type} ${name}`)
      if (!depSet) continue
      for (const sharedName of ['helper.js', 'client.jsx', 'page.md', 'domstack-manifest.settings.js']) {
        const filepath = `/site/${sharedName}`
        state[depSet].add(filepath)
        state.pageDepMap.set(filepath, new Set([other]))
        const batch = planWatchBatch(state, [classifyWatchEvent(type, filepath)])
        assert.equal(batch.inputChanges.resetReason, reason, `${type} ${sharedName}`)
      }
    }
  }
})

test('unknown changes reset and rebuild but known unused layouts and browser entries can skip', () => {
  const { state } = fixture()
  const unknown = classifyWatchEvent('change', '/site/unknown.js')
  assert.equal(planWatchEvent(state, unknown).kind, 'skip', 'single-event behavior is unchanged')
  const batch = planWatchBatch(state, [unknown])
  assert.equal(batch.plan.kind, 'full')
  assert.equal(batch.inputChanges.resetReason, 'unknown-event')
  state.layoutPageMap.clear()
  state.pagesFileLayoutMap.clear()
  const unusedLayout = planWatchBatch(state, [classifyWatchEvent('change', '/site/root.layout.js')])
  assert.equal(unusedLayout.plan.kind, 'skip')
  assert.equal(unusedLayout.inputChanges.resetReason, undefined)

  const unreliable = { ...unknown, type: 'rename' }
  // @ts-expect-error Runtime callers with unsupported event types must reset, without widening WatchEvent.
  const invalidBatch = planWatchBatch(state, [unreliable])
  assert.equal(invalidBatch.plan.kind, 'full')
  assert.equal(invalidBatch.inputChanges.resetReason, 'unreliable-event')
})

test('page-plan unions deduplicate paths and logging metadata for distinct objects representing one consumer', () => {
  const { state, home, template, owner } = fixture()
  state.pageDepMap.set('/site/shared.js', new Set([home, { ...home }]))
  state.templateDepMap.set('/site/shared.js', new Set([template, { ...template }]))
  state.pagesFileDepMap.set('/site/shared.js', new Set([owner, { ...owner }]))
  const event = classifyWatchEvent('change', '/site/shared.js')
  assert.deepEqual(planWatchBatch(state, [event]).plan, planWatchEvent(state, event), 'a single plan is preserved exactly')
  const batch = planWatchBatch(state, [event, event])
  assert.deepEqual(scope(batch.plan), [[home.pageFile.filepath], [template.templateFile.filepath], [owner.pagesFile.filepath]])
  assert.equal(batch.plan.kind, 'pages')
  if (batch.plan.kind !== 'pages') throw new Error('Expected a page plan')
  assert.deepEqual(batch.plan.pages, [home])
  assert.deepEqual(batch.plan.templates, [template])
  assert.deepEqual(batch.inputChanges.upsertedPaths, [home.pageFile.filepath])
})

test('markdown-only imports select only markdown pages and reset producer inputs', () => {
  const { state, home } = fixture()
  state.markdownDepPaths.add('/site/markdown-helper.js')
  const event = classifyWatchEvent('change', '/site/markdown-helper.js')
  assert.deepEqual(scope(planWatchEvent(state, event)), [[home.pageFile.filepath], [], []])
  const batch = planWatchBatch(state, [event])
  assert.deepEqual(scope(batch.plan), [[home.pageFile.filepath], [], []])
  assert.equal(batch.inputChanges.resetReason, 'markdown-settings-changed')
})

test('a full plan never short-circuits later input deltas or reset reasons', () => {
  const { state } = fixture()
  const restart = classifyWatchEvent('added', '/site/client.jsx')
  const config = classifyWatchEvent('change', '/site/global.vars.js')
  const added = classifyWatchEvent('added', '/site/new/page.md')
  for (const events of [[restart, config, added], [config, added, restart], [added, restart, config]]) {
    const batch = planWatchBatch(state, events)
    assert.equal(batch.plan.kind, 'full')
    assert.equal(batch.inputChanges.resetReason, 'global-vars-changed')
    assert.ok(batch.inputChanges.upsertedPaths.includes(added.filepath))
    assert.deepEqual(batch.inputChanges.events, events)
  }
})

test('reset reason uses the first applicable event after snapshot failure precedence', () => {
  const { state } = fixture()
  const data = classifyWatchEvent('change', '/site/global.data.js')
  const markdown = classifyWatchEvent('change', '/site/markdown-it.settings.js')
  assert.equal(planWatchBatch(state, [data, markdown]).inputChanges.resetReason, 'global-data-changed')
  assert.equal(planWatchBatch(state, [markdown, data]).inputChanges.resetReason, 'markdown-settings-changed')
  assert.deepEqual(scope(planWatchBatch(state, [data, markdown]).plan), [['/site/page.md'], [], []], 'reset does not force full output selection')
})
