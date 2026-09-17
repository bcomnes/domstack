/**
 * @import { SiteData } from '../builder.js'
 * @import { PageInfo, TemplateInfo, PagesFileInfo } from '../identify-pages.js'
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
 * @property {ReadonlySet<string>} [settingsDepPaths] Settings roots and imports require a full rebuild.
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
 * @property {string | undefined} [message]
 * @property {PageInfo[] | undefined} [pages]
 * @property {TemplateInfo[] | undefined} [templates]
 * @typedef {PagePlan | {kind: 'skip', message: string} | {kind: 'full', message: string} | {kind: 'restart', message: string}} WatchPlan
 * @typedef {object} WatchInputChanges
 * @property {string} [resetReason] Recompute all producer inputs instead of applying the delta.
 * @property {string[]} upsertedPaths Source-page candidates; reconcile against rediscovered membership before reading.
 * @property {WatchEvent[]} events Original events in order, including duplicates and removals.
 * @typedef {{ plan: WatchPlan, inputChanges: WatchInputChanges }} WatchBatchPlan
 */
import { basename, dirname, relative, resolve } from 'node:path'
import { classifyFile, fileConventions } from '../file-conventions.js'

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
  if (convention?.change === 'full' || convention?.change === 'markdown' || state.settingsDepPaths?.has(filepath)) {
    const action = type === 'change' ? 'changed' : type
    return { kind: 'full', message: `"${name}" ${action}, triggering full rebuild...` }
  }
  if (type !== 'change') {
    return convention?.bundleScope
      ? { kind: 'restart', message: `"${name}" ${type}, restarting esbuild...` }
      : { kind: 'full', message: `"${name}" ${type}, triggering full rebuild...` }
  }

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
  if (globalDataChanged || pages.size || templates.size || owners.size) {
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
  /** @type {WatchPlan[]} */
  const plans = []
  /** @type {WatchInputChanges} */
  const inputChanges = { upsertedPaths: [], events: [...events] }
  if (!events.length) return { plan: unionWatchPlans(plans), inputChanges }

  let resetReason = state.pageBuildFailed
    ? 'page-build-failed'
    : state.dependencyAnalysisFailed ? 'dependency-analysis-failed' : undefined
  /** @type {Set<string> | undefined} */
  let sourcePaths
  // Browser-only and template/owner-only changes need no source membership scan.
  const getSourcePaths = () => {
    if (!sourcePaths) {
      sourcePaths = new Set()
      for (const page of state.siteData.pages) {
        if (!page.generated) sourcePaths.add(page.pageFile.filepath)
      }
    }
    return sourcePaths
  }
  const upsertedPaths = new Set(/** @type {string[]} */ ([]))
  let allSourcesIncluded = false
  for (const event of events) {
    const eventPlan = planWatchEvent(state, event)
    const structural = event.type === 'added' || event.type === 'removed'
    const sourceEvent = structural && (event.name.endsWith('.md') ||
      (event.convention?.change === 'page' && !fileConventions.pageVars.names.includes(event.name)) ||
      getSourcePaths().has(event.filepath))
    // Only source membership changes need mapped consumers; other structural
    // events already invalidate every current source input.
    const changePlan = sourceEvent ? planWatchEvent(state, { ...event, type: 'change' }) : eventPlan
    const reason = inputResetReason(state, event, changePlan)
    resetReason ??= reason
    plans.push(eventPlan)
    if (reason === 'unknown-event' || reason === 'unreliable-event') {
      plans.length = 0
      plans.push({ kind: 'full', message: `"${event.name}" cannot be routed reliably, triggering full rebuild...` })
    }

    if (!allSourcesIncluded) {
      const allInputs = changePlan.kind === 'full' ||
        (structural && !sourceEvent) || reason === 'unreliable-event'
      const selected = changePlan.kind === 'pages' ? changePlan.pageFilterPaths : []
      if (allInputs || selected === null) {
        for (const path of getSourcePaths()) upsertedPaths.add(path)
        allSourcesIncluded = true
      } else {
        for (const path of selected) {
          if (getSourcePaths().has(path)) upsertedPaths.add(path)
        }
      }
    }
    if (structural && sourceEvent) upsertedPaths.add(event.filepath)
  }
  if (state.pageBuildFailed || state.dependencyAnalysisFailed) {
    plans.push(allPages())
  }
  if (resetReason) inputChanges.resetReason = resetReason
  inputChanges.upsertedPaths = [...upsertedPaths]
  return { plan: unionWatchPlans(plans), inputChanges }
}

/**
 * @param {WatchSnapshot} state
 * @param {WatchEvent} event
 * @param {WatchPlan} changePlan
 */
function inputResetReason (state, { type, filepath, name, convention }, changePlan) {
  if (type !== 'change' && type !== 'added' && type !== 'removed') return 'unreliable-event'
  if (convention?.change === 'pages' || state.globalDataDepPaths.has(filepath)) return 'global-data-changed'
  if (fileConventions.globalVars.names.includes(name)) return 'global-vars-changed'
  if (convention?.change === 'markdown') return 'markdown-settings-changed'
  if (convention?.change === 'full' || state.settingsDepPaths?.has(filepath)) return 'global-config-changed'
  if (type === 'change' && changePlan.kind === 'skip' &&
    convention?.change !== 'manifest' && !state.esbuildEntryPoints.has(filepath) &&
    !state.esbuildDepPaths?.has(filepath) && !hasWatchRole(state, filepath)) {
    return 'unknown-event'
  }
}

/** @param {WatchSnapshot} state @param {string} filepath */
function hasWatchRole (state, filepath) {
  return state.globalDataDepPaths.has(filepath) ||
    state.pageFileMap.has(filepath) || state.layoutFileMap.has(filepath) || state.layoutDepMap.has(filepath) ||
    state.pageDepMap.has(filepath) || state.templateDepMap.has(filepath) || state.pagesFileDepMap.has(filepath) ||
    state.siteData.templates.some(template => template.templateFile.filepath === filepath) ||
    state.siteData.pagesFiles?.some(owner => owner.pagesFile.filepath === filepath)
}

/** @param {WatchPlan[]} plans @returns {WatchPlan} */
function unionWatchPlans (plans) {
  /** @type {WatchPlan} */
  let selected = { kind: 'skip', message: 'No watch events to rebuild.' }
  let pagePlans = 0
  for (const plan of plans) {
    if (plan.kind === 'full') return plan
    if (plan.kind === 'restart') return { kind: 'full', message: 'Bundle membership changed, triggering full rebuild...' }
    if (plan.kind === 'pages') {
      selected = plan
      pagePlans++
    } else if (selected.kind === 'skip') selected = plan
  }
  if (pagePlans < 2) return selected

  // Accumulate once per batch rather than copying the growing union per event.
  /** @type {Set<string> | null} */
  let pagePaths = new Set()
  /** @type {Set<string> | null} */
  let templatePaths = new Set()
  /** @type {Set<string> | null} */
  let ownerPaths = new Set()
  /** @type {Map<string, PageInfo> | undefined} */
  let pages
  /** @type {Map<string, TemplateInfo> | undefined} */
  let templates
  const messages = new Set()
  for (const plan of plans) {
    if (plan.kind !== 'pages') continue
    pagePaths = addFilterPaths(pagePaths, plan.pageFilterPaths)
    templatePaths = addFilterPaths(templatePaths, plan.templateFilterPaths)
    ownerPaths = addFilterPaths(ownerPaths, plan.pagesFileFilterPaths)
    if (plan.pages) {
      pages ??= new Map()
      for (const page of plan.pages) pages.set(page.pageFile.filepath, page)
    }
    if (plan.templates) {
      templates ??= new Map()
      for (const template of plan.templates) templates.set(template.templateFile.filepath, template)
    }
    for (const message of plan.message?.split('\n') ?? []) messages.add(message)
  }
  return {
    kind: 'pages',
    pageFilterPaths: pagePaths && [...pagePaths],
    templateFilterPaths: templatePaths && [...templatePaths],
    pagesFileFilterPaths: ownerPaths && [...ownerPaths],
    pages: pages && [...pages.values()],
    templates: templates && [...templates.values()],
    message: messages.size ? [...messages].join('\n') : undefined,
  }
}

/** @param {Set<string> | null} paths @param {string[] | null} additions */
function addFilterPaths (paths, additions) {
  if (paths === null || additions === null) return null
  for (const path of additions) paths.add(path)
  return paths
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
