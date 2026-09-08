/**
 * @import { PageInfo, Layout, PageFileAsset } from './identify-pages.js'
 * @import { SiteData } from './builder.js'
 * @typedef {'page' | 'layout' | 'global' | 'service-worker' | null} BundleScope
 * @typedef {'page' | 'layout' | 'pages-file' | 'template' | 'full' | 'pages' | 'markdown' | 'manifest' | 'bundle'} ChangeKind
 * @typedef {{ names: string[], suffixes: string[], draftNames: string[], bundleScope: BundleScope, change: ChangeKind }} FileConvention
 */
import { extname } from 'node:path'
import { nodeHasTS } from './helpers/has-ts.js'

const javascriptExtensions = ['js', 'mjs', 'cjs']
const typescriptExtensions = ['ts', 'mts', 'cts']
const clientExtensions = ['tsx', ...typescriptExtensions, 'jsx', ...javascriptExtensions]
export const processedExtensions = [...clientExtensions, 'css', 'html', 'md']
export const layoutStyleSuffix = '.layout.css'
export const pageStyleName = 'style.css'

/**
 * @param {string[]} names
 * @param {ChangeKind} change
 * @param {BundleScope} [bundleScope]
 * @param {string[]} [suffixes]
 * @param {string[]} [draftNames]
 * @returns {FileConvention}
 */
function convention (names, change, bundleScope = null, suffixes = [], draftNames = []) {
  return { names, suffixes, draftNames, bundleScope, change }
}

/** @param {boolean} [supportsTypeScript] */
export function createFileConventions (supportsTypeScript = nodeHasTS) {
  const serverExtensions = supportsTypeScript ? [...typescriptExtensions, ...javascriptExtensions] : javascriptExtensions
  const names = (/** @type {string} */ stem, extensions = serverExtensions) => extensions.map(ext => `${stem}.${ext}`)
  return {
    page: convention(names('page'), 'page', null, [], names('page.draft')),
    htmlPage: convention(['page.html'], 'page', null, [], ['page.draft.html']),
    markdownPage: convention(['page.md'], 'page', null, [], ['page.draft.md']),
    readmePage: convention(['README.md'], 'page', null, [], ['README.draft.md']),
    pageVars: convention(names('page.vars'), 'page'),
    pageClient: convention(names('client', clientExtensions), 'bundle', 'page'),
    pageStyle: convention([pageStyleName], 'bundle', 'page'),
    pageWorker: convention([], 'bundle', 'page', names('.worker')),
    layout: convention([], 'layout', null, names('.layout')),
    layoutClient: convention([], 'bundle', 'layout', names('.layout.client', clientExtensions)),
    layoutStyle: convention([], 'bundle', 'layout', [layoutStyleSuffix]),
    template: convention([], 'template', null, names('.template')),
    pages: convention([], 'pages-file', null, names('.pages')),
    globalStyle: convention(['global.css', 'global.style.css'], 'bundle', 'global'),
    globalClient: convention(names('global.client', clientExtensions), 'bundle', 'global'),
    serviceWorker: convention(names('service-worker'), 'bundle', 'service-worker'),
    globalVars: convention(names('global.vars'), 'full'),
    globalData: convention(names('global.data'), 'pages'),
    esbuildSettings: convention(names('esbuild.settings'), 'full'),
    markdownSettings: convention(names('markdown-it.settings'), 'markdown'),
    manifestSettings: convention(names('domstack-manifest.settings'), 'manifest'),
  }
}

export const fileConventions = createFileConventions()

/**
 * Classify a basename; dynamic dependency membership belongs to the watch planner.
 * @param {string} name
 * @param {ReturnType<typeof createFileConventions>} [conventions]
 */
export function classifyFile (name, conventions = fileConventions) {
  return Object.values(conventions).find(rule =>
    rule.names.includes(name) || rule.draftNames.includes(name) || rule.suffixes.some(suffix => name.endsWith(suffix))
  )
}

/** @param {string} filepath */
export function isProcessedFile (filepath) {
  return processedExtensions.includes(extname(filepath).slice(1))
}

// Preserve existing discovery exports and filename priority for downstream users.
export const jsPageNames = fileConventions.page.names
export const jsPageDraftNames = fileConventions.page.draftNames
export const pageVarsNames = fileConventions.pageVars.names
export const pageClientNames = fileConventions.pageClient.names
export const pageWorkerSuffixs = fileConventions.pageWorker.suffixes
export const layoutSuffixs = fileConventions.layout.suffixes
export const layoutClientSuffixs = fileConventions.layoutClient.suffixes
export const templateSuffixs = fileConventions.template.suffixes
export const pagesSuffixs = fileConventions.pages.suffixes
export const globalStyleNames = fileConventions.globalStyle.names
export const globalClientNames = fileConventions.globalClient.names
export const serviceWorkerNames = fileConventions.serviceWorker.names
export const globalVarsNames = fileConventions.globalVars.names
export const globalDataNames = fileConventions.globalData.names
export const esbuildSettingsNames = fileConventions.esbuildSettings.names
export const markdownItSettingsNames = fileConventions.markdownSettings.names
export const domstackManifestSettingsNames = fileConventions.manifestSettings.names

/** @param {SiteData} siteData */
export function globalBundleAssets (siteData) {
  return presentAssets([siteData.globalClient, siteData.globalStyle])
}

/** @param {PageInfo} page */
export function pageBundleAssets (page) {
  return presentAssets([page.clientBundle, page.pageStyle, ...Object.values(page.workers ?? {})])
}

/** @param {Layout} layout */
export function layoutBundleAssets (layout) {
  return presentAssets([layout.layoutClient, layout.layoutStyle])
}

/** @param {(PageFileAsset | undefined)[]} assets */
function presentAssets (assets) {
  return assets.filter(asset => asset !== undefined)
}
