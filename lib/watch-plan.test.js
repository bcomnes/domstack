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

function fixture (hasGlobalDataState = true) {
  const home = page('')
  const other = page('other', 'js')
  const template = { templateFile: file('feed.template.js'), path: '', outputName: 'feed.xml' }
  const owner = { pagesFile: file('archive.pages.js'), path: '', name: 'archive' }
  const root = { ...file('root.layout.js'), layoutName: 'root', layoutStyle: file('root.layout.css') }
  const state = /** @satisfies {WatchSnapshot} */ ({
    siteData: { pages: [home, other], templates: [template], pagesFiles: [owner], layouts: { root } },
    layoutDepMap: new Map([['/site/layout-helper.js', new Set(['root'])]]),
    layoutPageMap: new Map([['root', new Set([home])]]),
    pageFileMap: new Map([[home.pageFile.filepath, home], [other.pageFile.filepath, other], ['/site/page.vars.js', home]]),
    layoutFileMap: new Map([[root.filepath, 'root']]),
    pageDepMap: new Map([['/site/page-helper.js', new Set([other])]]),
    templateDepMap: new Map([['/site/template-helper.js', new Set([template])]]),
    pagesFileDepMap: new Map([['/site/archive-helper.js', new Set([owner])]]),
    pagesFileLayoutMap: new Map([[owner.pagesFile.filepath, new Set(['root'])]]),
    globalDataDepPaths: new Set(['/site/global.data.js']),
    hasGlobalDataState,
    pageBuildFailed: false,
    esbuildEntryPoints: new Set(['/site/client.jsx', '/site/root.layout.css']),
  })
  return { state, home, other, template, owner }
}

/** @param {WatchPlan} plan */
function scope (plan) {
  assert.equal(plan.kind, 'pages')
  if (plan.kind !== 'pages') throw new Error('Expected a page plan')
  return [plan.pageFilterPaths, plan.templateFilterPaths, plan.pagesFileFilterPaths]
}

test('source text retains targeted scopes while modules and configuration roots reset retained state', () => {
  const { state, home } = fixture()
  const source = planWatchBatch(state, [classifyWatchEvent('change', home.pageFile.filepath)])
  assert.deepEqual(scope(source.plan), [[home.pageFile.filepath], [], []])
  assert.equal(source.inputChanges.resetReason, undefined)
  for (const name of ['page.vars.js', 'other/page.js', 'new/page.mjs']) {
    for (const type of /** @type {const} */ (['change', 'added', 'removed'])) {
      const batch = planWatchBatch(state, [classifyWatchEvent(type, `/site/${name}`)])
      assert.equal(batch.plan.kind, 'full')
      assert.equal(batch.inputChanges.resetReason, 'unknown-event')
    }
  }
  state.globalDataDepPaths.clear()
  assert.deepEqual(scope(planWatchEvent(state, classifyWatchEvent('change', '/site/global.data.js'))), [[], [], []])
  for (const [name, reason] of [
    ['global.data.js', 'global-data-changed'],
    ['global.vars.js', 'global-vars-changed'],
    ['markdown-it.settings.js', 'markdown-settings-changed'],
    ['esbuild.settings.js', 'global-config-changed'],
  ]) {
    for (const type of /** @type {const} */ (['change', 'added', 'removed'])) {
      const batch = planWatchBatch(state, [classifyWatchEvent(type, `/site/${name}`)])
      assert.equal(batch.inputChanges.resetReason, reason)
      assert.equal(batch.plan.kind, 'full')
    }
  }
  const skipped = planWatchEvent(state, classifyWatchEvent('change', '/site/domstack-manifest.settings.js'))
  assert.equal(skipped.kind, 'skip')
  assert.ok(skipped.message?.includes('disabled'))
})

test('helpers, browser entries, layouts, templates and factories reset and rebuild fully even with known consumers', () => {
  const { state } = fixture()
  for (const name of ['page-helper.js', 'layout-helper.js', 'template-helper.js', 'archive-helper.js', 'unknown.js', 'client.jsx', 'root.layout.css', 'root.layout.js', 'feed.template.js', 'archive.pages.js', 'domstack-manifest.settings.js']) {
    const event = classifyWatchEvent('change', `/site/${name}`)
    const batch = planWatchBatch(state, [event])
    assert.equal(batch.plan.kind, 'full', name)
    assert.equal(batch.inputChanges.resetReason, 'unknown-event', name)
  }
  state.layoutPageMap.clear()
  state.pagesFileLayoutMap.clear()
  assert.equal(planWatchBatch(state, [classifyWatchEvent('change', '/site/root.layout.js')]).plan.kind, 'full', 'an unused layout can still have an untracked configuration role')
})

test('without retained state legacy helper scopes and browser skips survive input reset requests', () => {
  for (const omitFlag of [false, true]) {
    const { state: snapshot, home, other, template, owner } = fixture(false)
    const state = /** @type {WatchSnapshot} */ ({ ...snapshot })
    if (omitFlag) delete state.hasGlobalDataState
    for (const [name, expected, reason] of /** @type {const} */ ([
      ['page-helper.js', [[other.pageFile.filepath], [], []], 'unknown-event'],
      ['page.vars.js', [[home.pageFile.filepath], [], []], 'unknown-event'],
      ['other/page.js', [[other.pageFile.filepath], [], []], 'unknown-event'],
      ['layout-helper.js', [[home.pageFile.filepath], [], [owner.pagesFile.filepath]], 'unknown-event'],
      ['root.layout.js', [[home.pageFile.filepath], [], [owner.pagesFile.filepath]], 'unknown-event'],
      ['template-helper.js', [[], [template.templateFile.filepath], []], 'unknown-event'],
      ['archive-helper.js', [[], [], [owner.pagesFile.filepath]], 'unknown-event'],
      ['feed.template.js', [[], [template.templateFile.filepath], []], 'unknown-event'],
      ['archive.pages.js', [[], [], [owner.pagesFile.filepath]], 'unknown-event'],
      ['global.data.js', [[], [], []], 'global-data-changed'],
      ['markdown-it.settings.js', [[home.pageFile.filepath], [], []], 'markdown-settings-changed'],
    ])) {
      const event = classifyWatchEvent('change', `/site/${name}`)
      const batch = planWatchBatch(state, [event])
      assert.deepEqual(scope(batch.plan), expected, name)
      assert.deepEqual(batch.plan, planWatchEvent(state, event), name)
      assert.equal(batch.inputChanges.resetReason, reason, name)
    }
    for (const name of ['client.jsx', 'root.layout.css', 'unknown.js', 'domstack-manifest.settings.js']) {
      const event = classifyWatchEvent('change', `/site/${name}`)
      const batch = planWatchBatch(state, [event])
      assert.equal(batch.plan.kind, 'skip', name)
      assert.deepEqual(batch.plan, planWatchEvent(state, event), name)
      assert.deepEqual(batch.inputChanges, { resetReason: 'unknown-event', upsertedPaths: [], events: [event] })
    }
    snapshot.globalDataDepPaths.add('/site/client.jsx')
    const imported = planWatchBatch(state, [classifyWatchEvent('change', '/site/client.jsx')])
    assert.deepEqual(scope(imported.plan), [[], [], []], 'producer imports take precedence over browser skips')
    assert.equal(imported.inputChanges.resetReason, 'global-data-changed')
  }
})

test('direct Markdown settings still union every known consumer before browser skips', () => {
  const { state, home, other, template, owner } = fixture(false)
  const filepath = '/site/markdown-it.settings.js'
  state.pageDepMap.set(filepath, new Set([other]))
  state.layoutDepMap.set(filepath, new Set(['root']))
  state.templateDepMap.set(filepath, new Set([template]))
  state.pagesFileDepMap.set(filepath, new Set([owner]))
  state.esbuildEntryPoints.add(filepath)
  const event = classifyWatchEvent('change', filepath)
  assert.deepEqual(scope(planWatchEvent(state, event)), [[other.pageFile.filepath, home.pageFile.filepath], [template.templateFile.filepath], [owner.pagesFile.filepath]])
  const batch = planWatchBatch(state, [event])
  assert.deepEqual(batch.plan, planWatchEvent(state, event))
  assert.equal(batch.inputChanges.resetReason, 'markdown-settings-changed')
})

test('shared helpers cannot hide configuration roles behind precise server or browser consumers', () => {
  const { state, template, owner } = fixture()
  const filepath = '/site/shared.js'
  state.layoutDepMap.set(filepath, new Set(['root']))
  state.pageDepMap.set(filepath, new Set(state.siteData.pages))
  state.templateDepMap.set(filepath, new Set([template]))
  state.pagesFileDepMap.set(filepath, new Set([owner]))
  state.esbuildEntryPoints.add(filepath)
  const before = structuredClone(state)
  const event = classifyWatchEvent('change', filepath)
  const batch = planWatchBatch(state, [event])
  assert.equal(batch.plan.kind, 'full')
  assert.equal(batch.inputChanges.resetReason, 'unknown-event')
  assert.deepEqual(planWatchBatch(state, [event]), batch)
  assert.deepEqual(state, before)
})

test('global-data imports reset and rebuild fully on every event even with shared roles', () => {
  for (const type of /** @type {const} */ (['change', 'added', 'removed'])) {
    for (const name of ['data-helper.js', 'client.jsx', 'page.md', 'domstack-manifest.settings.js']) {
      const { state, other } = fixture()
      const filepath = `/site/${name}`
      state.globalDataDepPaths.add(filepath)
      state.pageDepMap.set(filepath, new Set([other]))
      const batch = planWatchBatch(state, [classifyWatchEvent(type, filepath)])
      assert.equal(batch.plan.kind, 'full', `${type} ${name}`)
      assert.equal(batch.inputChanges.resetReason, 'global-data-changed')
    }
  }
})

test('manifest settings imported by server consumers do not hide those roles', () => {
  const { state, other } = fixture()
  const filepath = '/site/domstack-manifest.settings.js'
  state.pageDepMap.set(filepath, new Set([other]))
  const batch = planWatchBatch(state, [classifyWatchEvent('change', filepath)])
  assert.equal(batch.plan.kind, 'full')
  assert.equal(batch.inputChanges.resetReason, 'unknown-event')
})

test('direct source text selections union mapped consumers without mutating the snapshot', () => {
  const { state, home, other, template, owner } = fixture()
  const filepath = home.pageFile.filepath
  state.layoutDepMap.set(filepath, new Set(['root', 'another']))
  state.layoutPageMap.set('another', new Set([home]))
  state.pageDepMap.set(filepath, new Set([other]))
  state.templateDepMap.set(filepath, new Set([template]))
  state.pagesFileDepMap.set(filepath, new Set([owner]))
  const before = structuredClone(state)
  const batch = planWatchBatch(state, [classifyWatchEvent('change', filepath)])
  assert.deepEqual(scope(batch.plan), [[other.pageFile.filepath, home.pageFile.filepath], [template.templateFile.filepath], [owner.pagesFile.filepath]])
  assert.equal(batch.inputChanges.resetReason, undefined)
  assert.deepEqual(state, before)
})

test('failed builds preserve recovery plans and override event reset reasons', () => {
  const { state } = fixture()
  const failed = { ...state, pageBuildFailed: true }
  for (const name of ['page.md', 'page.vars.js', 'global.data.js', 'unused.js', 'client.jsx', 'root.layout.js', 'markdown-it.settings.js']) {
    const event = classifyWatchEvent('change', `/site/${name}`)
    const batch = planWatchBatch(failed, [event])
    assert.deepEqual(scope(batch.plan), [null, null, null])
    assert.ok(batch.plan.message?.includes('retrying all pages after the previous build failure'))
    assert.equal(batch.inputChanges.resetReason, 'page-build-failed')
  }
  for (const name of ['global.vars.js', 'esbuild.settings.js']) {
    const batch = planWatchBatch(failed, [classifyWatchEvent('change', `/site/${name}`)])
    assert.equal(batch.plan.kind, 'full')
    assert.equal(batch.inputChanges.resetReason, 'page-build-failed')
  }
  const skipped = planWatchBatch(failed, [classifyWatchEvent('change', '/site/domstack-manifest.settings.js')])
  assert.deepEqual(scope(skipped.plan), [null, null, null], 'a nonempty recovery batch cannot skip')
  assert.equal(skipped.inputChanges.resetReason, 'page-build-failed')
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

test('batch unions filtered output scopes and source inputs, retaining event order and duplicates', () => {
  const { state, home, other } = fixture()
  state.pageDepMap.set(home.pageFile.filepath, new Set([other]))
  const events = ['page.md', 'page.md', 'page.md']
    .map(name => classifyWatchEvent('change', `/site/${name}`))
  const before = structuredClone({ state, events })
  events.forEach(Object.freeze)
  Object.freeze(events)
  const batch = planWatchBatch(state, events)
  assert.deepEqual(scope(batch.plan), [[other.pageFile.filepath, home.pageFile.filepath], [], []])
  assert.equal(batch.plan.kind, 'pages')
  if (batch.plan.kind !== 'pages') throw new Error('Expected a page plan')
  assert.deepEqual(batch.plan.pages, [other, home])
  assert.deepEqual(batch.plan.templates, [])
  assert.equal(batch.plan.message, undefined, 'source-only batches need no reset message')
  assert.deepEqual(batch.inputChanges, { upsertedPaths: [other.pageFile.filepath, home.pageFile.filepath], events })
  assert.notEqual(batch.inputChanges.events, events)
  assert.deepEqual(planWatchBatch(state, events), batch)
  assert.deepEqual({ state, events }, before)
})

test('without retained state single page plans preserve metadata even when surrounded by skips', () => {
  const { state } = fixture(false)
  const skipped = classifyWatchEvent('change', '/site/domstack-manifest.settings.js')
  for (const name of ['page.md', 'page.vars.js', 'global.data.js']) {
    const event = classifyWatchEvent('change', `/site/${name}`)
    const expected = planWatchEvent(state, event)
    assert.equal(expected.kind, 'pages')
    for (const events of [[event], [skipped, event], [event, skipped], [skipped, event, skipped]]) {
      assert.deepEqual(planWatchBatch(state, events).plan, expected, name)
    }
    const failed = { ...state, pageBuildFailed: true }
    const recovery = planWatchBatch(failed, [event]).plan
    assert.deepEqual(scope(recovery), [null, null, null])
    assert.equal(recovery.message, planWatchEvent(failed, event).message, 'recovery preserves the single-event message')
  }
})

test('page-plan unions retain distinct messages in event order without duplicate lines', () => {
  const { state, home } = fixture(false)
  const data = classifyWatchEvent('change', '/site/global.data.js')
  const otherData = classifyWatchEvent('change', '/site/nested/global.data.mjs')
  const pageEvent = classifyWatchEvent('change', home.pageFile.filepath)
  for (const [first, second] of [[data, otherData], [otherData, data]]) {
    assert.ok(first && second)
    const batch = planWatchBatch(state, [first, pageEvent, second, first, second])
    assert.equal(batch.plan.kind, 'pages')
    if (batch.plan.kind !== 'pages') throw new Error('Expected a page plan')
    assert.deepEqual(batch.plan.pages, [home])
    assert.equal(batch.plan.message, [planWatchEvent(state, first).message, planWatchEvent(state, second).message].join('\n'))
  }
})

test('empty batches never reset or request recovery', () => {
  for (const hasGlobalDataState of [true, false]) {
    const { state } = fixture(hasGlobalDataState)
    for (const pageBuildFailed of [true, false]) {
      const batch = planWatchBatch({ ...state, pageBuildFailed }, [])
      assert.equal(batch.plan.kind, 'skip')
      assert.deepEqual(batch.inputChanges, { upsertedPaths: [], events: [] })
    }
  }
})

test('structural source pages carry membership candidates and mapped consumers without resetting', () => {
  for (const type of /** @type {const} */ (['added', 'removed'])) {
    for (const name of ['page.md', 'new/page.html', 'new/post.md']) {
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

test('Markdown and HTML source edits use deltas only when mapped and not global-data dependencies', () => {
  for (const type of /** @type {const} */ (['md', 'html'])) {
    const { state } = fixture()
    const post = { ...page('posts', type), pageFile: file(`posts/article.${type}`) }
    state.siteData.pages.push(post)
    state.pageFileMap.set(post.pageFile.filepath, post)
    const event = classifyWatchEvent('change', post.pageFile.filepath)
    const batch = planWatchBatch(state, [event])
    assert.deepEqual(scope(batch.plan), [[post.pageFile.filepath], [], []])
    assert.deepEqual(batch.inputChanges.upsertedPaths, [post.pageFile.filepath])
    assert.equal(batch.inputChanges.resetReason, undefined)
    state.globalDataDepPaths.add(event.filepath)
    const imported = planWatchBatch(state, [event])
    assert.equal(imported.plan.kind, 'full')
    assert.equal(imported.inputChanges.resetReason, 'global-data-changed')
    state.globalDataDepPaths.clear()
    state.pageFileMap.delete(event.filepath)
    const unmapped = planWatchBatch(state, [event])
    assert.equal(unmapped.plan.kind, 'full')
    assert.equal(unmapped.inputChanges.resetReason, 'unknown-event')
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

test('structural page vars and other non-source-text inputs reset with source-only candidates', () => {
  for (const type of /** @type {const} */ (['added', 'removed'])) {
    for (const name of ['page.vars.js', 'new/page.vars.mjs', 'root.layout.js', 'new.layout.js', 'helper.js', 'feed.template.js', 'archive.pages.js']) {
      const { state, home, other, owner } = fixture()
      state.siteData.pages.push({ ...page('generated'), generated: { pagesFile: owner } })
      const event = classifyWatchEvent(type, `/site/${name}`)
      const batch = planWatchBatch(state, [event])
      assert.equal(batch.plan.kind, 'full')
      assert.deepEqual(batch.inputChanges.upsertedPaths, [home.pageFile.filepath, other.pageFile.filepath])
      assert.deepEqual(batch.inputChanges.events, [event])
      assert.equal(batch.inputChanges.resetReason, 'unknown-event')
    }
  }
})

test('repeated all-source events preserve candidate order and later membership changes', () => {
  const { state, home, other } = fixture()
  const events = [
    classifyWatchEvent('change', '/site/other/page.js'),
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
    resetReason: 'unknown-event',
    events,
  })
  assert.deepEqual(state, before)
})

test('batch bundle restarts become full resets even when mixed with source deltas', () => {
  for (const name of ['client.jsx', 'root.layout.css', 'global.css', 'service-worker.js']) {
    const { state, home, other } = fixture()
    const restart = classifyWatchEvent('removed', `/site/${name}`)
    assert.equal(planWatchEvent(state, restart).kind, 'restart')
    for (const events of [[restart], [restart, classifyWatchEvent('change', '/site/page.md')], [classifyWatchEvent('added', '/site/new/page.md'), restart], [restart, classifyWatchEvent('added', '/site/new/page.md')]]) {
      const batch = planWatchBatch(state, events)
      assert.equal(batch.plan.kind, 'full')
      assert.equal(batch.inputChanges.resetReason, 'unknown-event')
      assert.ok(batch.inputChanges.upsertedPaths.includes(home.pageFile.filepath))
      assert.ok(batch.inputChanges.upsertedPaths.includes(other.pageFile.filepath))
    }
  }
})

test('unsupported event types force full resets even without retained state', () => {
  for (const hasGlobalDataState of [true, false]) {
    const { state } = fixture(hasGlobalDataState)
    const unreliable = { ...classifyWatchEvent('change', '/site/page.md'), type: 'rename' }
    // @ts-expect-error Runtime callers with unsupported event types must reset, without widening WatchEvent.
    const batch = planWatchBatch(state, [unreliable])
    assert.equal(batch.plan.kind, 'full')
    assert.equal(batch.inputChanges.resetReason, 'unreliable-event')
  }
})

test('page-plan unions deduplicate paths and logging metadata for distinct objects representing one consumer', () => {
  const { state, home, template, owner } = fixture()
  const filepath = home.pageFile.filepath
  state.pageDepMap.set(filepath, new Set([home, { ...home }]))
  state.templateDepMap.set(filepath, new Set([template, { ...template }]))
  state.pagesFileDepMap.set(filepath, new Set([owner, { ...owner }]))
  const event = classifyWatchEvent('change', filepath)
  assert.deepEqual(planWatchBatch(state, [event]).plan, planWatchEvent(state, event), 'a single plan is preserved exactly')
  const batch = planWatchBatch(state, [event, event])
  assert.deepEqual(scope(batch.plan), [[home.pageFile.filepath], [template.templateFile.filepath], [owner.pagesFile.filepath]])
  assert.equal(batch.plan.kind, 'pages')
  if (batch.plan.kind !== 'pages') throw new Error('Expected a page plan')
  assert.deepEqual(batch.plan.pages, [home])
  assert.deepEqual(batch.plan.templates, [template])
  assert.deepEqual(batch.inputChanges.upsertedPaths, [home.pageFile.filepath])
})

test('a full plan never short-circuits later input deltas or reset reasons', () => {
  const { state } = fixture()
  const structural = classifyWatchEvent('removed', '/site/page.md')
  const config = classifyWatchEvent('change', '/site/global.vars.js')
  const added = classifyWatchEvent('added', '/site/new/page.md')
  for (const events of [[structural, config, added], [config, added, structural], [added, structural, config]]) {
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
  assert.equal(planWatchBatch(state, [data, markdown]).plan.kind, 'full')
  const failed = { ...state, pageBuildFailed: true }
  assert.equal(planWatchBatch(failed, [data, markdown]).inputChanges.resetReason, 'page-build-failed')
})
