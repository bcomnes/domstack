/**
 * @import { FWStats } from 'async-folder-walker'
 * @import { DomStackWarning } from './helpers/dom-stack-warning.js'
 */
import { asyncFolderWalker } from 'async-folder-walker'
import assert from 'node:assert'
import { resolve, relative, join, basename } from 'path'
import { pageBuilders } from './build-pages/index.js'
import { DomStackDuplicatePageError } from './helpers/dom-stack-error.js'
import { nodeHasTS } from './helpers/has-ts.js'

const __dirname = import.meta.dirname

const getFirstMatch = (/** @type {{ [basename: string]: WalkerFile }} */ files, /** @type {string[][]} */ ...fileNames) => {
  const flatFileNames = fileNames.flat()
  for (const filename of flatFileNames) {
    const firstFound = files[filename]
    if (firstFound) {
      return firstFound
    }
  }
}

const jsPageNames = nodeHasTS
  ? ['page.ts', 'page.mts', 'page.cts', 'page.js', 'page.mjs', 'page.cjs']
  : ['page.js', 'page.mjs', 'page.cjs']

const jsPageDraftNames = nodeHasTS
  ? ['page.draft.ts', 'page.draft.mts', 'page.draft.cts', 'page.draft.js', 'page.draft.mjs', 'page.draft.cjs']
  : ['page.draft.js', 'page.draft.mjs', 'page.draft.cjs']

const pageClientNames = [
  'client.tsx', 'client.ts', 'client.mts', 'client.cts',
  'client.jsx', 'client.js', 'client.mjs', 'client.cjs'
]

const workerSuffix = '.worker'
const workerExtensions = nodeHasTS
  ? ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs']
  : ['.js', '.mjs', '.cjs']

const pageVarsNames = nodeHasTS
  ? ['page.vars.ts', 'page.vars.mts', 'page.vars.cts',
      'page.vars.js', 'page.vars.mjs', 'page.vars.cjs']
  : ['page.vars.js', 'page.vars.mjs', 'page.vars.cjs']

const layoutSuffixs = nodeHasTS
  ? ['.layout.ts', '.layout.mts', '.layout.cts', '.layout.js', '.layout.mjs', '.layout.cjs']
  : ['.layout.js', '.layout.mjs', '.layout.cjs']

const layoutClientSuffixs = [
  '.layout.client.tsx', '.layout.client.ts',
  '.layout.client.mts', '.layout.client.cts',
  '.layout.client.jsx', '.layout.client.js',
  '.layout.client.mjs', '.layout.client.cjs'
]

const layoutStyleSuffix = '.layout.css'

const templateSuffixs = nodeHasTS
  ? ['.template.ts', '.template.mts', '.template.cts', '.template.js', '.template.mjs', '.template.cjs']
  : ['.template.js', '.template.mjs', '.template.cjs']

const globalStyleNames = ['global.css', 'global.style.css']

const globalClientNames = [
  'global.client.tsx', 'global.client.ts',
  'global.client.mts', 'global.client.cts',
  'global.client.jsx', 'global.client.js',
  'global.client.mjs', 'global.client.cjs'
]

const globalVarsNames = nodeHasTS
  ? [
      'global.vars.ts', 'global.vars.mts', 'global.vars.cts',
      'global.vars.js', 'global.vars.mjs', 'global.vars.cjs'
    ]
  : ['global.vars.js', 'global.vars.mjs', 'global.vars.cjs']

const esbuildSettingsNames = nodeHasTS
  ? [
      'esbuild.settings.ts', 'esbuild.settings.mts', 'esbuild.settings.cts',
      'esbuild.settings.js', 'esbuild.settings.mjs', 'esbuild.settings.cjs'
    ]
  : ['esbuild.settings.js', 'esbuild.settings.mjs', 'esbuild.settings.cjs']

const markdownItSettingsNames = nodeHasTS
  ? [
      'markdown-it.settings.ts', 'markdown-it.settings.mts', 'markdown-it.settings.cts',
      'markdown-it.settings.js', 'markdown-it.settings.mjs', 'markdown-it.settings.cjs'
    ]
  : ['markdown-it.settings.js', 'markdown-it.settings.mjs', 'markdown-it.settings.cjs']

/**
 * Shape the file walker object
 *
 * @param {FWStats} param - The file stats.
 */
const shaper = ({
  root,
  filepath,
  /* stat, */
  relname,
  basename,
}) => ({
  root,
  filepath,
  relname,
  basename,
  parentName: relname.slice(0, -(basename.length + 1)),
})

/**
 * @typedef {ReturnType<typeof shaper>} WalkerFile
 */

/**
  * @typedef {WalkerFile & Partial<{
  *            outputRelname: string,
  *            outputName: string,
  *            }>} PageFileAsset
  */

/**
  * @typedef {WalkerFile & { layoutName: string } & Partial<{
  *            layoutStyle: PageFileAsset,
  *            layoutClient: PageFileAsset
  *            }>} Layout
  */

/**
 * @typedef {'js' | 'md' | 'html'} PageTypes
 */

/**
 * @typedef {WalkerFile & {
 *   type?: PageTypes
 * }} PageFile
 */

/**
 * @typedef PageInfo
 * @property {PageFile} pageFile - The main page data.
 * @property {PageTypes} type - The type of the page.
 * @property {PageFileAsset | undefined} [pageStyle] - The style of the page. (Replace 'any' with the appropriate type if known.)
 * @property {PageFileAsset | undefined} [clientBundle] - The client bundle for the page. (Replace 'any' with the appropriate type if known.)
 * @property {PageFileAsset | undefined} [pageVars] - The variables associated with the page. (Replace 'any' with the appropriate type if known.)
 * @property {Object<string, PageFileAsset> | undefined} [workers] - Web worker files associated with this page.
 * @property {string} path - The directory path for the page.
 * @property {string} outputName - The name of the output file.
 * @property {string} outputRelname - The relative name/path for the output file.
 * @property {boolean} draft - If the page is marked as a draft or not. Draft pages are only included when buildDrafts is passed.
 */

/**
 * @typedef TemplateInfo
 * @property {WalkerFile} templateFile - The template file info.
 * @property {string} path - The the path of the parent dir of the template
 * @property {string} outputName - The derived output name of the template file. Might be overridden.
 */

/**
 * Identifies the pages, layouts, templates, and other relevant data from a given source directory.
 *
 * @function
 * @export
 * @param {string} src - The source directory to identify pages from.
 * @param {object} [opts={}] - Options to modify the behavior of the function.
 * @param {string[]?} [opts.ignore] - Array of file/folder patterns to ignore during the walk.
 * @param {boolean?} [opts.buildDrafts=false] - Includes pages with the variable publushed:false when set to true
 * @throws When the `src` argument is not provided or something else goes wrong.
 */
export async function identifyPages (src, opts = {}) {
  assert(src, 'a src argument is required')

  const walker = asyncFolderWalker([src], {
    statFilter: st => !st.isDirectory(),
    ignore: opts?.ignore ?? [],
    shaper,
  })

  /**
   * @type {{ [parentName: string]: { [basename: string]: WalkerFile } }}
   */
  const dirs = {} // all files keyed by their parent dir relpath

  for await (const file of walker) {
    const dir = dirs[file.parentName]
    if (!dir) {
      dirs[file.parentName] = {
        [file.basename]: file,
      }
    } else {
      dir[file.basename] = file
    }
  }

  /** @type {{ [layoutName: string]: Layout }} */
  const layouts = {}

  /** @type {PageInfo[]} */
  let pages = []

  /** @type {TemplateInfo[]} The array of discovered template files */
  const templates = []

  /** @type {PageFileAsset | undefined } */
  let globalStyle

  /** @type {PageFileAsset | undefined } */
  let globalClient

  /** @type {PageFileAsset | undefined } */
  let globalVars

  /** @type {PageFileAsset | undefined } */
  let esbuildSettings

  /** @type {PageFileAsset | undefined } */
  let markdownItSettings

  /** @type {DomStackWarning[]} */
  const warnings = []

  /** @type {Error[]} */
  const errors = []

  /** @type {string[]} */
  // const nonPageFolders = []

  for (const [dir, files] of Object.entries(dirs)) {
    /** @type {PageFile | undefined } */
    const jsPage = opts?.buildDrafts
      ? getFirstMatch(files, jsPageNames, jsPageDraftNames)
      : getFirstMatch(files, jsPageNames)
    if (jsPage) jsPage.type = 'js'
    /** @type {PageFile | undefined} */
    const htmlPage = opts?.buildDrafts
      ? files['page.html'] ?? files['page.draft.html']
      : files['page.html']
    if (htmlPage) htmlPage.type = 'html'
    /** @type {PageFile | undefined} */
    const readmePage = opts?.buildDrafts
      ? files['README.md'] ?? files['README.draft.md']
      : files['README.md']
    if (readmePage) readmePage.type = 'md'

    const pageStyle = files['style.css']
    const clientBundle = getFirstMatch(files, pageClientNames)
    const pageVars = getFirstMatch(files, pageVarsNames)

    // Identify web worker files (format: {name}.worker.{js|ts|...})
    /** @type {{ [name: string]: PageFileAsset }} */
    const workerFiles = {}
    for (const [fileName, fileInfo] of Object.entries(files)) {
      const workerMatch = workerExtensions.some(ext =>
        fileName.endsWith(workerSuffix + ext)
      )

      if (workerMatch && fileName.includes(workerSuffix)) {
        // Extract worker name (everything before .worker.{ext})
        const workerName = fileName.split(workerSuffix)[0]
        if (workerName) {
          workerFiles[workerName] = fileInfo
        }
      }
    }

    const conflict = jsPage && htmlPage

    if (conflict) {
      const err = new DomStackDuplicatePageError(
        'Conflicting page sources: The page has two page sources. Pages only support one page type.',
        {
          a: join(dir, 'page.js'),
          b: join(dir, 'page.html'),
        }
      )
      errors.push(err)
    }

    const page = (conflict)
      ? null
      : jsPage || htmlPage || readmePage

    if (page && page.type) {
      pages.push({
        pageFile: page,
        type: page.type,
        pageStyle,
        clientBundle,
        pageVars,
        workers: Object.keys(workerFiles).length > 0 ? { ...workerFiles } : undefined,
        path: dir,
        outputName: 'index.html',
        outputRelname: join(dir, 'index.html'),
        draft: opts?.buildDrafts ? /\.draft\.(html|md|js)$/.test(page.basename) : false
      })
    }

    // if (!page && !conflict) nonPageFolders.push(dir)

    for (const [fileName, fileInfo] of Object.entries(files)) {
      // Render loose MD pages in place. No styles, no clients, no vars file.

      const isMarkdownFile = fileName.endsWith('.md')
      const isDraftFile = fileName.endsWith('.draft.md')
      const isReadmeFile = fileName === 'README.md' || fileName === 'README.draft.md'

      if (
        !isReadmeFile && (
          (opts.buildDrafts && (isMarkdownFile || isDraftFile)) ||
          (!opts.buildDrafts && (isMarkdownFile && !isDraftFile))
        )
      ) {
        const outputName = isDraftFile ? fileInfo.basename.replace('.draft.md', '.html') : fileInfo.basename.replace('.md', '.html')
        pages.push({
          pageFile: fileInfo,
          type: 'md',
          path: dir,
          outputName,
          outputRelname: join(dir, outputName),
          draft: opts.buildDrafts ? isDraftFile : false
        })
      }

      if (layoutSuffixs.some(suffix => fileName.endsWith(suffix))) {
        const suffix = layoutSuffixs.find(suffix => fileName.endsWith(suffix))
        if (!suffix) throw new Error('layout suffix not found')
        const layoutName = fileName.slice(0, -suffix.length)

        if (layouts?.[layoutName]?.relname) {
          warnings.push(
            /** @type {DomStackWarningCode} */
            {
              code: 'DOM_STACK_WARNING_DUPLICATE_LAYOUT',
              message: `Skipping ${fileInfo.relname}. Duplicate layout name ${layoutName} to ${layouts?.[layoutName]?.relname}`,
            })
        } else {
          layouts[layoutName] = { ...fileInfo, layoutName }
        }
      }

      if (fileName.endsWith(layoutStyleSuffix)) {
        const layoutStyleName = fileName.slice(0, -layoutStyleSuffix.length)

        if (layouts?.[layoutStyleName]?.layoutStyle) {
          warnings.push({
            code: 'DOM_STACK_WARNING_DUPLICATE_LAYOUT_STYLE',
            message: `Skipping ${fileInfo.relname}. Duplicate layout style name ${layoutStyleName} to ${layouts?.[layoutStyleName]?.layoutStyle?.relname}`,
          })
        } else {
          const layout = layouts[layoutStyleName]
          if (layout) {
            layout.layoutStyle = fileInfo
          } else {
            warnings.push({
              code: 'DOM_STACK_WARNING_ORPHANED_LAYOUT_STYLE',
              message: `Skipping ${fileInfo.relname}. A layout style ${layoutStyleName} was found without a matching layout`,
            })
          }
        }
      }

      if (layoutClientSuffixs.some(suffix => fileName.endsWith(suffix))) {
        const suffix = layoutClientSuffixs.find(suffix => fileName.endsWith(suffix))
        if (!suffix) throw new Error('layout client suffix not found')
        const layoutClientName = fileName.slice(0, -suffix.length)

        if (layouts?.[layoutClientName]?.layoutClient) {
          warnings.push({
            code: 'DOM_STACK_WARNING_DUPLICATE_LAYOUT_CLIENT',
            message: `Skipping ${fileInfo.relname}. Duplicate layout client name ${layoutClientName} to ${layouts?.[layoutClientName]?.layoutClient?.relname}`,
          })
        } else {
          const layout = layouts[layoutClientName]
          if (layout) {
            layout.layoutClient = fileInfo
          } else {
            warnings.push({
              code: 'DOM_STACK_WARNING_ORPHANED_LAYOUT_CLIENT',
              message: `Skipping ${fileInfo.relname}. A layout client ${layoutClientName} was found without a matching layout`,
            })
          }
        }
      }

      if (templateSuffixs.some(suffix => fileName.endsWith(suffix))) {
        const suffix = templateSuffixs.find(suffix => fileName.endsWith(suffix))
        if (!suffix) throw new Error('template suffix not found')
        const templateFileName = fileName.slice(0, -suffix.length)

        templates.push({
          templateFile: fileInfo,
          path: dir,
          outputName: templateFileName,
        })
      }

      if (globalStyleNames.some(name => basename(fileName) === name)) {
        if (globalStyle) {
          warnings.push({
            code: 'DOM_STACK_WARNING_DUPLICATE_GLOBAL_STYLE',
            message: `Skipping ${fileInfo.relname}. Duplicate global style ${fileName} to ${globalStyle.filepath}`,
          })
        } else {
          globalStyle = fileInfo
        }
      }

      if (globalClientNames.some(name => basename(fileName) === name)) {
        if (globalClient) {
          warnings.push({
            code: 'DOM_STACK_WARNING_DUPLICATE_GLOBAL_CLIENT',
            message: `Skipping ${fileInfo.relname}. Duplicate global client ${fileName} to ${globalClient.filepath}`,
          })
        } else {
          globalClient = fileInfo
        }
      }

      if (globalVarsNames.some(name => basename(fileName) === name)) {
        if (globalVars) {
          warnings.push({
            code: 'DOM_STACK_WARNING_DUPLICATE_GLOBAL_VARS',
            message: `Skipping ${fileInfo.relname}. Duplicate global client ${fileName} to ${globalVars.filepath}`,
          })
        } else {
          globalVars = fileInfo
        }
      }

      if (esbuildSettingsNames.some(name => basename(fileName) === name)) {
        if (esbuildSettings) {
          warnings.push({
            code: 'DOM_STACK_WARNING_DUPLICATE_ESBUILD_SETTINGS',
            message: `Skipping ${fileInfo.relname}. Duplicate esbuild options ${fileName} to ${esbuildSettings.filepath}`,
          })
        } else {
          esbuildSettings = fileInfo
        }
      }

      if (markdownItSettingsNames.some(name => basename(fileName) === name)) {
        if (markdownItSettings) {
          warnings.push({
            code: 'DOM_STACK_WARNING_DUPLICATE_MARKDOWN_IT_SETTINGS',
            message: `Skipping ${fileInfo.relname}. Duplicate markdown-it settings ${fileName} to ${markdownItSettings.filepath}`,
          })
        } else {
          markdownItSettings = fileInfo
        }
      }
    }
  }

  // const rootFiles = dirs[''] ?? {}

  let defaultLayout = false

  if (!layouts['root']) {
    warnings.push({
      code: 'DOM_STACK_WARNING_NO_ROOT_LAYOUT',
      message: 'Missing a root.layout.js file. Using default layout file.',
    })
    defaultLayout = true

    const defaultLayoutBasename = 'default.root.layout.js'
    const defaultLayoutFilepath = resolve(__dirname, `./defaults/${defaultLayoutBasename}`)
    const defaultLayoutRelpath = relative(src, defaultLayoutFilepath)

    layouts['root'] = {
      root: src,
      filepath: defaultLayoutFilepath,
      relname: defaultLayoutRelpath,
      basename: defaultLayoutBasename,
      parentName: defaultLayoutRelpath.slice(0, -(defaultLayoutBasename.length + 1)),
      layoutName: 'root',
    }
  }

  pages = pages.filter(p => {
    if (pageBuilders[p.type]) return true
    else {
      warnings.push({
        code: 'DOM_STACK_WARNING_UNKNOWN_PAGE_BUILDER',
        message: `Skipping ${p.path}. Unimplemented type ${p.type}`,
      })
    }
    return false
  })

  const results = {
    globalStyle,
    globalClient,
    globalVars,
    esbuildSettings,
    markdownItSettings,
    /** @type {string?} Path to a default style */
    defaultStyle: null,
    /** @type {string?} Path to a default client */
    defaultClient: null,
    layouts,
    templates,
    pages,
    warnings,
    errors,
    defaultLayout,
    // nonPageFolders
    // allFiles: dirs
  }

  return results
}
