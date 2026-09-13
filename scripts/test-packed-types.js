import { execFile, spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const projectPath = path.resolve(import.meta.dirname, '..')
const { dependencies, devDependencies } = JSON.parse(await readFile(path.join(projectPath, 'package.json'), 'utf8'))
const temporaryPath = await mkdtemp(path.join(tmpdir(), 'domstack-packed-types-'))
const consumerPath = path.join(temporaryPath, 'consumer')

try {
  await Promise.all([
    run('npm', ['run', 'clean:declarations-top'], projectPath),
    run('npm', ['run', 'clean:declarations-lib'], projectPath),
  ])
  await run('npm', ['run', 'build:declaration'], projectPath)
  const { stdout } = await execFileAsync(
    'npm',
    ['pack', '--json', '--ignore-scripts', '--pack-destination', temporaryPath],
    { cwd: projectPath, encoding: 'utf8' }
  )
  const [{ filename }] = JSON.parse(stdout)
  const tarballPath = path.join(temporaryPath, filename)

  await mkdir(consumerPath)
  await Promise.all([
    writeFile(path.join(consumerPath, 'package.json'), `${JSON.stringify({
      name: 'domstack-packed-type-consumer',
      private: true,
      type: 'module',
      dependencies: {
        '@domstack/static': `file:${tarballPath}`,
        '@types/node': '^26.0.1',
        pino: dependencies.pino,
        typescript: devDependencies.typescript,
      },
    }, null, 2)}\n`),
    writeFile(path.join(consumerPath, 'index.ts'), `import { DomStack, PageData } from '@domstack/static'
import pino from 'pino'

const stack = new DomStack('src', 'public', { logger: pino({ level: 'silent' }) })
void PageData
void stack
`),
    writeFile(path.join(consumerPath, 'types.ts'), `import pino from 'pino'
import type { WorkerOptions } from 'node:worker_threads'
import type {
  DomStackOpts,
  GeneratedPageForLayout,
  LayoutChain,
  LayoutChainVars,
  LayoutFunction,
  LayoutPageOutput,
  LayoutResult,
  PageForLayout,
  PageFunction,
  PagesForLayout,
  Results,
  ValidatePageVars,
} from '@domstack/static/types.js'

const logger = pino({ level: 'silent' })
const options: DomStackOpts = { buildDrafts: true, logger }
const render: PageFunction<Record<string, unknown>, string> = ({ vars }) => String(vars)

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false
type Expect<Value extends true> = Value

type Frame = { html: string }
const rootLayout: LayoutFunction<{ siteName: string }, Frame, Uint8Array> = ({ children }) => new TextEncoder().encode(children.html)
const parentLayout = 'root'
const articleVars = async () => ({ showSidebar: true })
const articleLayout: LayoutFunction<{ siteName: string, showSidebar: boolean }, string, Frame> = ({ children }) => ({ html: children })

declare module '@domstack/static/types.js' {
  interface LayoutRegistry {
    root: {
      render: typeof rootLayout
    }
    article: {
      parentLayout: typeof parentLayout
      vars: typeof articleVars
      render: typeof articleLayout
    }
  }
}

type _Chain = Expect<Equal<LayoutChain<'article'>, readonly ['root', 'article']>>
type _PageOutput = Expect<Equal<LayoutPageOutput<'article'>, string>>
type _LayoutResult = Expect<Equal<LayoutResult<'article'>, Uint8Array>>
type _Vars = Expect<Equal<
  LayoutChainVars<'article', { siteName: string }, { slug: string }>['slug'],
  string
>>

// With exactOptionalPropertyTypes disabled, an optional override can supply undefined.
type _OptionalOverride = Expect<Equal<
  LayoutChainVars<'article', { siteName: string, x: string }, { x?: number }>['x'],
  string | number | undefined
>>

type ArticlePage = PageForLayout<'article', { slug: string }, { body: string }, { siteName: string }>
const articlePage: ArticlePage = ({ vars, data }) => {
  vars.siteName
  vars.showSidebar
  vars.slug
  data.body
  // @ts-expect-error Layout data is not merged into page data.
  data.navigation
  return 'article'
}
// @ts-expect-error The article layout accepts string page output.
const invalidArticlePage: ArticlePage = () => ({ html: 'invalid' })

type _MissingSiteName = Expect<Equal<ValidatePageVars<'article', { slug: string }>, never>>
type _ValidatedPageVars = Expect<Equal<
  ValidatePageVars<'article', { slug: string }, { siteName: string }>,
  { slug: string }
>>
type _MissingGeneratedGlobals = Expect<Equal<GeneratedPageForLayout<'article', { slug: string }>, never>>
type _MissingFactoryGlobals = Expect<Equal<PagesForLayout<'article', { slug: string }>, never>>

type GeneratedArticle = GeneratedPageForLayout<'article', { slug: string }, { body: string }, { siteName: string }>
type _SuppliedGeneratedVars = Expect<Equal<GeneratedArticle['vars'], { slug: string } & { layout: 'article' }>>
const generatedArticle: GeneratedArticle = {
  vars: { layout: 'article', slug: 'generated' },
  children: ({ vars, data }) => {
    vars.layout satisfies 'article'
    vars.siteName.toUpperCase()
    vars.showSidebar.valueOf()
    vars.slug.toUpperCase()
    data.body.toUpperCase()
    // @ts-expect-error Inline page data does not include factory data.
    data.slugs
    return data.body
  },
}
// Layout defaults and globals need not be repeated in the supplied vars.
const emptyGeneratedArticle: GeneratedArticle = { vars: { layout: 'article', slug: 'empty' } }
// @ts-expect-error Generated definitions must supply vars.
const missingGeneratedVars: GeneratedArticle = { children: 'article' }
// @ts-expect-error The runtime layout selector is required.
const missingGeneratedLayout: GeneratedArticle = { vars: { slug: 'article' } }
// @ts-expect-error Supplied page vars are required independently of defaults.
const missingGeneratedSlug: GeneratedArticle = { vars: { layout: 'article' } }
// @ts-expect-error The layout selector must be the registered literal.
const wrongGeneratedLayout: GeneratedArticle = { vars: { layout: 'root', slug: 'article' } }
// @ts-expect-error Static children must match the article layout input.
const wrongGeneratedChildren: GeneratedArticle = { vars: { layout: 'article', slug: 'article' }, children: { html: 'invalid' } }
// @ts-expect-error Inline renderer output must match the article layout input.
const wrongGeneratedRenderer: GeneratedArticle = { vars: { layout: 'article', slug: 'article' }, children: () => ({ html: 'invalid' }) }

type ArticlePages = PagesForLayout<'article', { slug: string }, { siteName: string }, { slugs: string[] }, { body: string }>
const articlePages: ArticlePages = ({ vars, data }) => {
  vars.siteName.toUpperCase()
  // @ts-expect-error Layout defaults are not available to the factory.
  vars.showSidebar
  // @ts-expect-error Generated page vars are not available to the factory.
  vars.slug
  // @ts-expect-error Inline page data is not factory data.
  data.body
  return data.slugs.map(slug => ({
    vars: { layout: 'article', slug },
    children: ({ vars, data }) => {
      vars.siteName.toUpperCase()
      vars.showSidebar.valueOf()
      vars.slug.toUpperCase()
      // @ts-expect-error Factory data is not merged into inline page data.
      data.slugs
      return data.body.toUpperCase()
    },
  }))
}
const asyncArticlePages: ArticlePages = async ({ data }) => ({
  vars: { layout: 'article', slug: data.slugs[0] },
  children: ({ data }) => data.body,
})
const iterableArticlePages: ArticlePages = async function * ({ vars, data }) {
  vars.siteName.toUpperCase()
  for (const slug of data.slugs) {
    yield { vars: { layout: 'article', slug }, children: 'article' } satisfies GeneratedArticle
  }
}

void generatedArticle
void emptyGeneratedArticle
void missingGeneratedVars
void missingGeneratedLayout
void missingGeneratedSlug
void wrongGeneratedLayout
void wrongGeneratedChildren
void wrongGeneratedRenderer
void articlePages
void asyncArticlePages
void iterableArticlePages

// The logger option retains Pino's full contract.
const configuredLogger: pino.Logger | undefined = options.logger
const childOptions: DomStackOpts = { logger: logger.child({ component: 'consumer' }) }
// @ts-expect-error A generic logging object is not a Pino logger.
const invalidOptions: DomStackOpts = { logger: { info () {} } }

// The compatibility alias preserves the transport's transfer-list type, not any.
type TransferItem = NonNullable<Parameters<ReturnType<typeof pino.transport>['emit']>[2]>[number]
declare const item: TransferItem
const expected: NonNullable<WorkerOptions['transferList']>[number] = item
const actual: TransferItem = expected
// @ts-expect-error A primitive is not transferable.
const invalidTransfer: TransferItem = 123

void render
void articlePage
void invalidArticlePage
void configuredLogger
void childOptions
void invalidOptions
void actual
void invalidTransfer
void ({} as Results)
`),
    writeFile(path.join(consumerPath, 'js-root.layout.js'), `/** @import { LayoutFunction } from '@domstack/static/types.js' */

/** @type {LayoutFunction<{ siteName: string }, { html: string }, Uint8Array, { navigation: string[] }>} */
const rootLayout = ({ vars, children, data }) => {
  vars.siteName.toUpperCase()
  data.navigation.map(item => item.toUpperCase())
  return new TextEncoder().encode(children.html)
}

export default rootLayout
`),
    writeFile(path.join(consumerPath, 'js-article.layout.js'), `/** @import { LayoutFunction } from '@domstack/static/types.js' */

export const parentLayout = 'js-root'
export const vars = async () => ({ showSidebar: true })

/** @type {LayoutFunction<{ siteName: string, showSidebar: boolean }, string, { html: string }, { related: string[] }>} */
const articleLayout = ({ vars, children, data }) => {
  vars.siteName.toUpperCase()
  vars.showSidebar.valueOf()
  data.related.map(item => item.toUpperCase())
  return { html: children.toUpperCase() }
}

export default articleLayout
`),
    writeFile(path.join(consumerPath, 'js-layout-registry.d.ts'), `import type rootLayout from './js-root.layout.js'
import type articleLayout from './js-article.layout.js'
import type { parentLayout, vars } from './js-article.layout.js'

declare module '@domstack/static/types.js' {
  interface LayoutRegistry {
    'js-root': {
      render: typeof rootLayout
    }
    'js-article': {
      parentLayout: typeof parentLayout
      vars: typeof vars
      render: typeof articleLayout
    }
  }
}
`),
    writeFile(path.join(consumerPath, 'js-page.js'), `/** @import { GeneratedPageForLayout, PageForLayout, PagesForLayout } from '@domstack/static/types.js' */

export const layout = 'js-article'

/** @type {PageForLayout<typeof layout, { slug: string }, { body: string }, { siteName: string }>} */
const articlePage = ({ vars, data }) => {
  vars.siteName.toUpperCase()
  vars.showSidebar.valueOf()
  vars.slug.toUpperCase()
  data.body.toUpperCase()
  // @ts-expect-error Ancestor layout data is not merged into page data.
  data.navigation
  // @ts-expect-error Immediate layout data is not merged into page data.
  data.related
  return data.body
}

/** @type {PageForLayout<typeof layout, { slug: string }, { body: string }, { siteName: string }>} */
// @ts-expect-error The article layout accepts string page output, not a frame.
const invalidArticlePage = () => ({ html: 'invalid' })

/** @type {GeneratedPageForLayout<typeof layout, { slug: string }, { body: string }, { siteName: string }>} */
export const generatedArticle = {
  vars: { layout: 'js-article', slug: 'generated' },
  children: ({ vars, data }) => {
    vars.siteName.toUpperCase()
    vars.showSidebar.valueOf()
    vars.slug.toUpperCase()
    // @ts-expect-error Layout data is not merged into inline page data.
    data.related
    return data.body.toUpperCase()
  },
}

/** @type {PagesForLayout<typeof layout, { slug: string }, { siteName: string }, { slugs: string[] }, { body: string }>} */
export const articlePages = ({ vars, data }) => {
  vars.siteName.toUpperCase()
  // @ts-expect-error Layout defaults are not available to the factory.
  vars.showSidebar
  // @ts-expect-error Inline page data is not factory data.
  data.body
  return data.slugs.map(slug => ({
    vars: { layout: 'js-article', slug },
    children: ({ vars, data }) => {
      vars.siteName.toUpperCase()
      vars.showSidebar.valueOf()
      vars.slug.toUpperCase()
      // @ts-expect-error Factory data is not merged into inline page data.
      data.slugs
      return data.body.toUpperCase()
    },
  }))
}

void invalidArticlePage
export default articlePage
`),
    writeFile(path.join(consumerPath, 'tsconfig.json'), `${JSON.stringify({
      compilerOptions: {
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        noEmit: true,
        skipLibCheck: false,
        strict: true,
        target: 'ES2022',
        types: ['node'],
      },
      include: ['index.ts'],
    }, null, 2)}\n`),
    writeFile(path.join(consumerPath, 'tsconfig-types.json'), `${JSON.stringify({
      extends: './tsconfig.json',
      include: ['types.ts'],
    }, null, 2)}\n`),
    writeFile(path.join(consumerPath, 'tsconfig-js.json'), `${JSON.stringify({
      extends: './tsconfig.json',
      compilerOptions: {
        allowJs: true,
        checkJs: true,
        strict: true,
        skipLibCheck: false,
      },
      include: ['js-root.layout.js', 'js-article.layout.js', 'js-page.js', 'js-layout-registry.d.ts'],
    }, null, 2)}\n`),
  ])

  await run(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock'],
    consumerPath
  )
  // Node 26 exercises the missing alias; 24 and 22 guard against duplicate
  // declarations on supported older releases. Check each entry in isolation.
  for (const nodeVersion of [26, 24, 22]) {
    if (nodeVersion !== 26) {
      await run(
        'npm',
        ['install', `@types/node@^${nodeVersion}.0.0`, '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock'],
        consumerPath
      )
    }
    for (const config of ['tsconfig.json', 'tsconfig-types.json', 'tsconfig-js.json']) {
      console.log(`Checking TypeScript ${devDependencies.typescript}, @types/node ${nodeVersion}, ${config}`)
      await run(
        process.execPath,
        [path.join(consumerPath, 'node_modules', 'typescript', 'bin', 'tsc'), '--project', config],
        consumerPath
      )
    }
  }
} finally {
  await rm(temporaryPath, { recursive: true, force: true })
  await Promise.all([
    run('npm', ['run', 'clean:declarations-top'], projectPath),
    run('npm', ['run', 'clean:declarations-lib'], projectPath),
  ])
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {string} cwd
 * @returns {Promise<void>}
 */
function run (command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${command} exited with ${signal ?? code}`))
      }
    })
  })
}
