import { test } from 'node:test'
import assert from 'node:assert'
import { readFile } from 'node:fs/promises'
import {
  DOMSTACK_MANIFEST_SCHEMA_ID,
  DOMSTACK_MANIFEST_SCHEMA_PATH,
  PageData,
  domstackManifestEntryPageMetaSchema,
  domstackManifestEntrySchema,
  domstackManifestKindSchema,
  domstackManifestSchema,
  getDomstackManifestSchemaId,
} from '../../index.js'
import type {
  AsyncGlobalDataFunction,
  AsyncLayoutFunction,
  AsyncPageFunction,
  BuildOptions,
  DomStackOpts,
  DomstackManifest,
  DomstackManifestEntry,
  DomstackManifestEntryPageMeta,
  DomstackManifestKind,
  DomstackManifestRecord,
  GlobalDataFunction,
  GlobalDataFunctionParams,
  LayoutFunction,
  LayoutFunctionParams,
  PageFunction,
  PageFunctionParams,
  PageInfo,
  Results,
  ServiceWorkerInfo,
  SiteData,
  TemplateAsyncIterator,
  TemplateFunction,
  TemplateFunctionParams,
  TemplateInfo,
  TemplateOutputOverride,
  TestBuildResult,
} from '#types'

const walkerFile = {
  root: '/src',
  filepath: '/src/index.html',
  relname: 'index.html',
  basename: 'index.html',
  parentName: '',
}

const pageInfo: PageInfo = {
  pageFile: { ...walkerFile, type: 'html' },
  type: 'html',
  path: '',
  url: '/',
  outputName: 'index.html',
  outputRelname: 'index.html',
  draft: false,
}

const templateInfo: TemplateInfo = {
  templateFile: walkerFile,
  path: 'feeds',
  outputName: 'feed.xml',
}

const serviceWorkerInfo: ServiceWorkerInfo = {
  ...walkerFile,
  basename: 'service-worker.js',
  relname: 'globals/service-worker.js',
}

const pageData = new PageData({
  pageInfo,
  globalVars: {},
  globalStyle: undefined,
  globalClient: undefined,
  defaultStyle: null,
  defaultClient: null,
  builderOptions: {},
})

const layoutParams: LayoutFunctionParams<Record<string, any>, string, string> = {
  vars: { title: 'Hello' },
  children: 'Body',
  page: pageInfo,
  pages: [pageData],
}

const pageParams: PageFunctionParams<Record<string, any>, string> = {
  vars: { title: 'Hello' },
  page: pageInfo,
  pages: [pageData],
}

const templateParams: TemplateFunctionParams<Record<string, any>> = {
  vars: { siteName: 'DomStack' },
  template: templateInfo,
  pages: [pageData],
}

const globalDataParams: GlobalDataFunctionParams = {
  pages: [pageData],
}

const layoutFunction: LayoutFunction<{ title: string }, string, string> = ({ vars, children }) => `${vars.title}: ${children}`
const asyncLayoutFunction: AsyncLayoutFunction<{ title: string }, string, string> = async ({ vars, children }) => `${vars.title}: ${children}`
const pageFunction: PageFunction<{ title: string }, string> = ({ vars }) => vars.title
const asyncPageFunction: AsyncPageFunction<{ title: string }, string> = async ({ vars }) => vars.title
const templateFunction: TemplateFunction<{ siteName: string }> = async ({ vars }) => vars.siteName
const templateAsyncIterator: TemplateAsyncIterator<{ siteName: string }> = async function * ({ vars }) {
  yield { content: vars.siteName, outputName: 'site-name.txt' }
}
const globalDataFunction: GlobalDataFunction<{ generated: true }> = () => ({ generated: true })
const asyncGlobalDataFunction: AsyncGlobalDataFunction<{ generated: true }> = async () => ({ generated: true })

const templateOutputOverride: TemplateOutputOverride = {
  content: 'Hello',
  outputName: 'hello.txt',
}

const buildOptions: BuildOptions = {
  bundle: true,
}

const domStackOpts: DomStackOpts = {
  static: true,
}

const siteData: SiteData | null = null
const results: Results | null = null
const testBuildResult: TestBuildResult | null = null
const domstackManifestKind: DomstackManifestKind = 'page'
const domstackManifestEntryPageMeta: DomstackManifestEntryPageMeta = {
  path: '',
  url: '/',
  vars: {
    precache: true,
  },
}
const domstackManifestEntry: DomstackManifestEntry = {
  outputRelname: 'index.html',
  kind: domstackManifestKind,
  url: '/',
  revision: 'revision',
  bytes: 42,
  page: domstackManifestEntryPageMeta,
}
const domstackManifest: DomstackManifest = {
  $schema: DOMSTACK_MANIFEST_SCHEMA_ID,
  version: 'version',
  generatedAt: new Date(0).toISOString(),
  entries: [domstackManifestEntry],
}
const domstackManifestRecord: DomstackManifestRecord = {
  outputRelname: 'index.html',
  filepath: '/public/index.html',
  kind: 'page',
}

void layoutParams
void pageParams
void templateParams
void globalDataParams
void layoutFunction
void asyncLayoutFunction
void pageFunction
void asyncPageFunction
void templateFunction
void templateAsyncIterator
void globalDataFunction
void asyncGlobalDataFunction
void templateOutputOverride
void buildOptions
void domStackOpts
void serviceWorkerInfo
void siteData
void results
void testBuildResult
void domstackManifestKind
void domstackManifestEntryPageMeta
void domstackManifestEntry
void domstackManifest
void domstackManifestRecord

test('PageData is importable from the package entry point', () => {
  assert.strictEqual(typeof PageData, 'function', 'PageData is a class')
})

test('domstack manifest schemas are importable from the package entry point', async () => {
  const [schemaJson, packageJson] = await Promise.all([
    readFile(new URL('../../lib/domstack-manifest/schema.json', import.meta.url), 'utf8'),
    readFile(new URL('../../package.json', import.meta.url), 'utf8'),
  ])
  const schemaFile = JSON.parse(schemaJson)
  const packageInfo = JSON.parse(packageJson)

  assert.deepStrictEqual(
    schemaFile,
    domstackManifestSchema,
    'packaged schema.json matches exported schema'
  )
  assert.ok(
    DOMSTACK_MANIFEST_SCHEMA_ID.includes(`@${packageInfo.version}/`),
    'manifest schema ID includes the package version'
  )
  assert.strictEqual(
    DOMSTACK_MANIFEST_SCHEMA_ID,
    getDomstackManifestSchemaId(packageInfo.version),
    'schema ID helper builds the exported schema ID from the package version'
  )
  assert.strictEqual(
    DOMSTACK_MANIFEST_SCHEMA_PATH,
    'lib/domstack-manifest/schema.json',
    'schema path points at the packaged JSON schema'
  )
  assert.strictEqual(
    domstackManifestSchema.$id,
    DOMSTACK_MANIFEST_SCHEMA_ID,
    'manifest schema uses exported schema ID'
  )
  assert.strictEqual(
    domstackManifestSchema.properties.$schema.const,
    DOMSTACK_MANIFEST_SCHEMA_ID,
    'manifest instance schema field uses exported schema ID'
  )
  assert.ok(domstackManifestKindSchema.enum.includes('page'), 'kind schema includes pages')
  assert.strictEqual(
    domstackManifestEntrySchema.properties.page,
    domstackManifestEntryPageMetaSchema,
    'entry schema uses page metadata schema'
  )
  assert.strictEqual(
    domstackManifestSchema.properties.entries.items,
    domstackManifestEntrySchema,
    'manifest schema uses entry schema'
  )
})
