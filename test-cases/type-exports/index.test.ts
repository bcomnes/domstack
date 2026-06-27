import { test } from 'node:test'
import assert from 'node:assert'
import { PageData } from '../../index.js'
import type {
  AsyncGlobalDataFunction,
  AsyncLayoutFunction,
  AsyncPageFunction,
  BuildOptions,
  DomStackOpts,
  GlobalDataFunction,
  GlobalDataFunctionParams,
  LayoutFunction,
  LayoutFunctionParams,
  PageFunction,
  PageFunctionParams,
  PageInfo,
  Results,
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
void siteData
void results
void testBuildResult

test('PageData is importable from the package entry point', () => {
  assert.strictEqual(typeof PageData, 'function', 'PageData is a class')
})
