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
 * @property {boolean} pageBuildFailed
 * @property {ReadonlySet<string>} esbuildEntryPoints
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
 */
import { basename, dirname, relative } from 'node:path'
import { classifyFile } from './file-conventions.js'

/**
 * @param {'change' | 'added' | 'removed'} type
 * @param {string} filepath Absolute source path.
 */
export function classifyWatchEvent (type, filepath) {
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
  if (convention?.change === 'full') return { kind: 'full', message: `"${name}" changed, triggering full rebuild...` }
  if (convention?.change === 'markdown') {
    const pages = siteData.pages.filter(page => page.type === 'md')
    return selectedPages(pages)
  }
  if (convention?.change === 'manifest') {
    return { kind: 'skip', message: `"${name}" changed but domstack manifests are disabled in watch mode, skipping.` }
  }
  if (state.pageBuildFailed) {
    return { ...allPages(), message: `"${name}" changed, retrying all pages after the previous build failure...` }
  }

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
  const globalDataChanged = state.globalDataDepPaths.has(filepath)
  if (globalDataChanged || pages.size || templates.size || owners.size) {
    return {
      ...selectedPages([...pages]),
      templateFilterPaths: [...templates].map(template => template.templateFile.filepath),
      pagesFileFilterPaths: [...owners],
      templates: [...templates],
      ...(globalDataChanged ? { message: `"${name}" changed, rebuilding data subscribers...` } : {}),
    }
  }
  if (state.esbuildEntryPoints.has(filepath)) {
    return { kind: 'skip', message: `"${name}" changed, esbuild will handle rebundling.` }
  }
  return { kind: 'skip', message: `"${name}" changed but did not match any rebuild rule, skipping.` }
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

/** @param {PageInfo[]} pages */
function pagePaths (pages) {
  return pages.map(page => page.pageFile.filepath)
}

/** @param {PageInfo[]} pages @returns {PagePlan} */
function selectedPages (pages) {
  return { ...allPages(), pageFilterPaths: pagePaths(pages), templateFilterPaths: [], pagesFileFilterPaths: [], pages }
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
  const owners = new Set([...state.pagesFileLayoutMap]
    .filter(([, usedLayouts]) => [...usedLayouts].some(name => layoutNames.has(name)))
    .map(([owner]) => owner))
  return { pages, owners }
}
