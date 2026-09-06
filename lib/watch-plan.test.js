/**
 * @import { WatchSnapshot, WatchPlan } from './watch-plan.js'
 * @import { WalkerFile, PageInfo, PageTypes } from './identify-pages.js'
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { basename, dirname, join } from 'node:path'
import { classifyWatchEvent, planWatchEvent, planBundleChange } from './watch-plan.js'

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
  for (const name of ['unused.js', 'client.jsx', 'root.layout.js', 'global.data.js']) {
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
