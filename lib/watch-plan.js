/**
 * @import { SiteData } from './builder.js'
 * @import { PageInfo, TemplateInfo, PagesFileInfo } from './identify-pages.js'
 * @typedef {object} WatchSnapshot
 * @property {Pick<SiteData, 'pages' | 'templates' | 'pagesFiles' | 'layouts'>} siteData
 * @property {ReadonlyMap<string, ReadonlySet<string>>} layoutDepMap
 * @property {ReadonlyMap<string, ReadonlySet<PageInfo>>} layoutPageMap
 * @property {ReadonlyMap<string, PageInfo>} pageFileMap
 * @property {ReadonlyMap<string, string>} layoutFileMap
 * @property {ReadonlyMap<string, ReadonlySet<PageInfo>>} pageDepMap
 * @property {ReadonlyMap<string, ReadonlySet<TemplateInfo>>} templateDepMap
 * @property {ReadonlyMap<string, ReadonlySet<PagesFileInfo>>} pagesFileDepMap
 * @property {ReadonlyMap<string, ReadonlySet<string>>} pagesFileLayoutMap
 * @property {ReadonlySet<string>} globalDataDepPaths
 * @property {ReadonlySet<string>} [globalVarsDepPaths]
 * @property {ReadonlySet<string>} [markdownDepPaths]
 * @property {boolean} [dependencyAnalysisFailed]
 * @property {boolean} pageBuildFailed
 * @property {ReadonlySet<string>} esbuildEntryPoints
 * @property {ReadonlySet<string>} [esbuildDepPaths] Known imported browser inputs; server roles still take precedence.
 * @typedef {ReturnType<typeof classifyWatchEvent>} WatchEvent
 * @typedef {object} PagePlan
 * @property {'pages'} kind
 * @property {string[] | null} pageFilterPaths
 * @property {string[] | null} templateFilterPaths
 * @property {string[] | null} pagesFileFilterPaths
 * @property {string} [message]
 * @property {PageInfo[]} [pages]
 * @property {TemplateInfo[]} [templates]
 * @typedef {PagePlan | {kind: 'skip', message: string} | {kind: 'full', message: string} | {kind: 'restart', message: string}} WatchPlan
 * @typedef {object} WatchInputChanges
 * @property {string} [resetReason] Recompute all producer inputs instead of applying the delta.
 * @property {string[]} upsertedPaths Source-page candidates; reconcile against rediscovered membership before reading.
 * @property {WatchEvent[]} events Original events in order, including duplicates and removals.
 * @typedef {{ plan: WatchPlan, inputChanges: WatchInputChanges }} WatchBatchPlan
 */
import { basename, dirname, relative, resolve } from 'node:path'
import { classifyFile, fileConventions } from './file-conventions.js'

/**
 * @param {'change' | 'added' | 'removed'} type
 * @param {string} filepath Source path, resolved against the current working directory.
 */
export function classifyWatchEvent (type, filepath) {
  filepath = resolve(filepath)
  const name = basename(filepath)
  return { type, filepath, name, convention: classifyFile(name) }
}

/**
 * Plan from the last successful watch snapshot without doing I/O or mutating it.
 * @param {WatchSnapshot} state
 * @param {WatchEvent} event
 * @returns {WatchPlan}
 */
export function planWatchEvent (state, event) {
  const { type, filepath, name, convention } = event
  const { siteData } = state
  if (type !== 'change') {
    return convention?.bundleScope
      ? { kind: 'restart', message: `"${name}" ${type}, restarting esbuild...` }
      : { kind: 'full', message: `"${name}" ${type}, triggering full rebuild...` }
  }
  if (convention?.change === 'full' || state.globalVarsDepPaths?.has(filepath)) return { kind: 'full', message: `"${name}" changed, triggering full rebuild...` }
  if (convention?.change === 'manifest' && !hasWatchRole(state, filepath)) {
    return { kind: 'skip', message: `"${name}" changed but domstack manifests are disabled in watch mode, skipping.` }
  }
  if (state.pageBuildFailed) return retryAllPages(event)

  // A module can have several roles, including both browser and server uses.
  // Union every direct and imported consumer before deciding to skip it.
  const layouts = new Set(state.layoutDepMap.get(filepath))
  const directLayout = state.layoutFileMap.get(filepath)
  if (directLayout) layouts.add(directLayout)
  const affected = layoutConsumers(state, layouts)
  const pages = new Set(state.pageDepMap.get(filepath))
  const markdownChanged = convention?.change === 'markdown' || state.markdownDepPaths?.has(filepath)
  if (markdownChanged) {
    for (const page of siteData.pages) {
      if (page.type === 'md') pages.add(page)
    }
  }
  const directPage = state.pageFileMap.get(filepath)
  if (directPage) pages.add(directPage)
  for (const page of affected.pages) pages.add(page)

  const templates = new Set(state.templateDepMap.get(filepath))
  for (const template of siteData.templates) {
    if (template.templateFile.filepath === filepath) templates.add(template)
  }
  const owners = affected.owners
  for (const owner of state.pagesFileDepMap.get(filepath) ?? []) {
    owners.add(owner.pagesFile.filepath)
  }
  for (const owner of siteData.pagesFiles ?? []) {
    if (owner.pagesFile.filepath === filepath) owners.add(filepath)
  }

  // Even without direct consumers, a producer input must recompute global data.
  // The page worker selects subscribers after comparing the resulting values.
  const globalDataChanged = convention?.change === 'pages' || state.globalDataDepPaths.has(filepath)
  if (globalDataChanged || markdownChanged || pages.size || templates.size || owners.size) {
    const plan = selectedPages([...pages])
    plan.templates = [...templates]
    plan.templateFilterPaths = plan.templates.map(template => template.templateFile.filepath)
    plan.pagesFileFilterPaths = [...owners]
    if (globalDataChanged) plan.message = `"${name}" changed, rebuilding data subscribers...`
    return plan
  }
  if (state.esbuildEntryPoints.has(filepath) || state.esbuildDepPaths?.has(filepath)) {
    return { kind: 'skip', message: `"${name}" changed, esbuild will handle rebundling.` }
  }
  return { kind: 'skip', message: `"${name}" changed but did not match any rebuild rule, skipping.` }
}

/**
 * Union output selections independently of producer-input invalidation. Null
 * filters mean all; full dominates pages/skip. Batch restarts become full because
 * their HTML scope cannot be resolved until discovery and esbuild have run.
 * A page plan paired with skip is preserved exactly, including logging metadata.
 * Page-plan unions also union pages/templates by filepath and distinct message
 * lines in event order so logging retains every selected consumer and reason.
 *
 * A full output plan requires rediscovery, but does not itself reset inputs.
 * Structural source events upsert the change-plan's source consumers plus the
 * event path (including removed paths). Other structural events upsert all
 * current source pages. The worker must reconcile membership after rediscovery;
 * these candidates are not instructions to read deleted files. Templates and
 * generated-page owners are output selections, not source-input rows.
 *
 * A reset supersedes the delta. Reasons are page-build-failed, then
 * dependency-analysis-failed, then the first applicable event reason, using
 * this per-event priority:
 * unreliable-event, global-data-changed, global-vars-changed,
 * markdown-settings-changed, global-config-changed, or unknown-event.
 * Unknown changes reset; unknown adds/removes can use conservative deltas.
 * Empty batches skip without requesting recovery. Inputs are never mutated.
 *
 * @param {WatchSnapshot} state
 * @param {ReadonlyArray<WatchEvent>} events Events from classifyWatchEvent.
 * @returns {WatchBatchPlan}
 */
export function planWatchBatch (state, events) {
  /** @type {WatchPlan} */
  let plan = { kind: 'skip', message: 'No watch events to rebuild.' }
  /** @type {WatchInputChanges} */
  const inputChanges = { upsertedPaths: [], events: [...events] }
  if (!events.length) return { plan, inputChanges }

  let resetReason = state.pageBuildFailed
    ? 'page-build-failed'
    : state.dependencyAnalysisFailed ? 'dependency-analysis-failed' : undefined
  const sourcePaths = new Set(/** @type {string[]} */ ([]))
  for (const page of state.siteData.pages) {
    if (!page.generated) sourcePaths.add(page.pageFile.filepath)
  }
  const upsertedPaths = new Set(/** @type {string[]} */ ([]))
  let allSourcesIncluded = false
  for (const event of events) {
    const eventPlan = planWatchEvent(state, event)
    const structural = event.type === 'added' || event.type === 'removed'
    const sourceEvent = structural && (event.name.endsWith('.md') ||
      (event.convention?.change === 'page' && !fileConventions.pageVars.names.includes(event.name)) ||
      sourcePaths.has(event.filepath))
    // Only source membership changes need mapped consumers; other structural
    // events already invalidate every current source input.
    const changePlan = sourceEvent ? planWatchEvent(state, { ...event, type: 'change' }) : eventPlan
    const reason = inputResetReason(state, event, changePlan)
    resetReason ??= reason
    plan = unionWatchPlans(plan, eventPlan)
    if (reason === 'unknown-event' || reason === 'unreliable-event') {
      plan = { kind: 'full', message: `"${event.name}" cannot be routed reliably, triggering full rebuild...` }
    }

    if (!allSourcesIncluded) {
      const allInputs = changePlan.kind === 'full' ||
        (structural && !sourceEvent) || reason === 'unreliable-event'
      const selected = changePlan.kind === 'pages' ? changePlan.pageFilterPaths : []
      if (allInputs || selected === null) {
        for (const path of sourcePaths) upsertedPaths.add(path)
        allSourcesIncluded = true
      } else {
        for (const path of selected) {
          if (sourcePaths.has(path)) upsertedPaths.add(path)
        }
      }
    }
    if (structural && sourceEvent) upsertedPaths.add(event.filepath)
  }
  if (state.pageBuildFailed || state.dependencyAnalysisFailed) {
    plan = unionWatchPlans(plan, allPages())
  }
  if (resetReason) inputChanges.resetReason = resetReason
  inputChanges.upsertedPaths = [...upsertedPaths]
  return { plan, inputChanges }
}

/**
 * @param {WatchSnapshot} state
 * @param {WatchEvent} event
 * @param {WatchPlan} changePlan
 */
function inputResetReason (state, { type, filepath, name, convention }, changePlan) {
  if (type !== 'change' && type !== 'added' && type !== 'removed') return 'unreliable-event'
  if (convention?.change === 'pages' || state.globalDataDepPaths.has(filepath)) return 'global-data-changed'
  if (fileConventions.globalVars.names.includes(name) || state.globalVarsDepPaths?.has(filepath)) return 'global-vars-changed'
  if (convention?.change === 'markdown' || state.markdownDepPaths?.has(filepath)) return 'markdown-settings-changed'
  if (convention?.change === 'full') return 'global-config-changed'
  if (type === 'change' && changePlan.kind === 'skip' &&
    convention?.change !== 'manifest' && !state.esbuildEntryPoints.has(filepath) &&
    !state.esbuildDepPaths?.has(filepath) && !hasWatchRole(state, filepath)) {
    return 'unknown-event'
  }
}

/** @param {WatchSnapshot} state @param {string} filepath */
function hasWatchRole (state, filepath) {
  return state.globalDataDepPaths.has(filepath) || state.globalVarsDepPaths?.has(filepath) || state.markdownDepPaths?.has(filepath) ||
    state.pageFileMap.has(filepath) || state.layoutFileMap.has(filepath) || state.layoutDepMap.has(filepath) ||
    state.pageDepMap.has(filepath) || state.templateDepMap.has(filepath) || state.pagesFileDepMap.has(filepath) ||
    state.siteData.templates.some(template => template.templateFile.filepath === filepath) ||
    state.siteData.pagesFiles?.some(owner => owner.pagesFile.filepath === filepath)
}

/** @param {WatchPlan} left @param {WatchPlan} right @returns {WatchPlan} */
function unionWatchPlans (left, right) {
  if (left.kind === 'full') return left
  if (right.kind === 'full') return right
  if (left.kind === 'restart' || right.kind === 'restart') {
    return { kind: 'full', message: 'Bundle membership changed, triggering full rebuild...' }
  }
  if (right.kind === 'skip') return left.kind === 'skip' ? right : left
  if (left.kind === 'skip') return right
  const messages = new Set([...(left.message?.split('\n') ?? []), ...(right.message?.split('\n') ?? [])])
  return {
    kind: 'pages',
    pageFilterPaths: unionFilterPaths(left.pageFilterPaths, right.pageFilterPaths),
    templateFilterPaths: unionFilterPaths(left.templateFilterPaths, right.templateFilterPaths),
    pagesFileFilterPaths: unionFilterPaths(left.pagesFileFilterPaths, right.pagesFileFilterPaths),
    ...(left.pages || right.pages
      ? {
          pages: [...new Map([...(left.pages ?? []), ...(right.pages ?? [])].map(page => [page.pageFile.filepath, page])).values()],
        }
      : {}),
    ...(left.templates || right.templates
      ? {
          templates: [...new Map([...(left.templates ?? []), ...(right.templates ?? [])].map(template => [template.templateFile.filepath, template])).values()],
        }
      : {}),
    ...(messages.size ? { message: [...messages].join('\n') } : {}),
  }
}

/** @param {string[] | null} left @param {string[] | null} right */
function unionFilterPaths (left, right) {
  if (left === null || right === null) return null
  const paths = new Set(left)
  for (const path of right) paths.add(path)
  return [...paths]
}

/**
 * Select HTML consumers after discovery and esbuild have refreshed bundle metadata.
 * The reverse maps still describe the last successful map refresh, including
 * source pages and layouts used by generated pages.
 * @param {WatchSnapshot} state
 * @param {WatchEvent} event
 * @param {string} src
 * @returns {WatchPlan}
 */
export function planBundleChange (state, event, src) {
  const { convention, filepath, name, type } = event
  if (convention?.bundleScope === 'service-worker') {
    return { kind: 'skip', message: `"${name}" ${type}, no page rebuild needed.` }
  }
  if (state.pageBuildFailed) return retryAllPages(event)
  if (convention?.bundleScope === 'global') return { ...allPages(), pages: [...state.siteData.pages] }
  if (convention?.bundleScope === 'layout') {
    const layout = Object.values(state.siteData.layouts).find(layout =>
      layout.layoutClient?.filepath === filepath || layout.layoutStyle?.filepath === filepath
    )
    if (layout) {
      const { pages, owners } = layoutConsumers(state, new Set([layout.layoutName]))
      if (pages.size || owners.size) return { ...selectedPages([...pages]), pagesFileFilterPaths: [...owners] }
    }
    // A removed asset may no longer identify a layout; keep the conservative fallback.
    return { ...allPages(), templateFilterPaths: [] }
  }
  const page = state.siteData.pages.find(page => page.path === relative(src, dirname(filepath)))
  return page ? selectedPages([page]) : allPages()
}

/** @returns {PagePlan} */
function allPages () {
  return { kind: 'pages', pageFilterPaths: null, templateFilterPaths: null, pagesFileFilterPaths: null }
}

/**
 * Recovery cannot use incremental routing from a failed build.
 * Both planners apply this before selecting consumers, after intentional skips.
 * @param {WatchEvent} event
 * @returns {PagePlan}
 */
function retryAllPages ({ name, type }) {
  const action = type === 'change' ? 'changed' : type
  return { ...allPages(), message: `"${name}" ${action}, retrying all pages after the previous build failure...` }
}

/** @param {PageInfo[]} pages */
function pagePaths (pages) {
  return pages.map(page => page.pageFile.filepath)
}

/** @param {PageInfo[]} pages @returns {PagePlan} */
function selectedPages (pages) {
  return { kind: 'pages', pageFilterPaths: pagePaths(pages), templateFilterPaths: [], pagesFileFilterPaths: [], pages }
}

/**
 * @param {WatchSnapshot} state
 * @param {ReadonlySet<string>} layoutNames
 */
function layoutConsumers (state, layoutNames) {
  const pages = new Set(/** @type {PageInfo[]} */ ([]))
  for (const layoutName of layoutNames) {
    for (const page of state.layoutPageMap.get(layoutName) ?? []) pages.add(page)
  }
  const owners = new Set(/** @type {string[]} */ ([]))
  if (layoutNames.size > 0) {
    for (const [owner, usedLayouts] of state.pagesFileLayoutMap) {
      for (const name of usedLayouts) {
        if (layoutNames.has(name)) {
          owners.add(owner)
          break
        }
      }
    }
  }
  return { pages, owners }
}
