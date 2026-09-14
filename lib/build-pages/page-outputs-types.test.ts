import type {
  PageOutput,
  PageOutputProvenance,
  PageOutputsFunction,
  PageOutputsFunctionParams,
  PageOutputsPage,
  PageOutputsResult,
  CollectedPageOutput,
  PageData,
  DomstackManifestRecord,
} from '../../types.ts'
import { normalizePageOutputs } from './page-outputs.js'
import { writePageOutputs } from './page-builders/page-output-writer.js'
import type { PageOutputCache } from './page-builders/page-output-writer.js'

// Compile-only assertions for the public type entry and the narrow hook contract.
export function checkPageOutputsTypes (pageData: PageData<{ title: string }>, page: PageOutputsPage) {
  const output: PageOutput = { outputName: 'feed.json', content: '' }
  const provenance: PageOutputProvenance = { kind: 'layout', source: 'base.layout.ts', layoutName: 'base' }
  const collected: CollectedPageOutput = { ...output, provenance }
  const result: PageOutputsResult = [output]
  const hook: PageOutputsFunction<{ title: string }, { posts: string[] }> = async ({ page, vars, data }) => ({
    outputName: 'feed.json', content: vars.title + page.url + data.posts.join(','),
  })
  const params: PageOutputsFunctionParams<{ title: string }, { posts: string[] }> = { page, vars: { title: 'title' }, data: { posts: [] } }
  const outputs: AsyncGenerator<CollectedPageOutput, void, unknown> = pageData.collectPageOutputs()
  const normalized: AsyncGenerator<CollectedPageOutput, void, unknown> = normalizePageOutputs(result, provenance)
  const iterable: AsyncIterable<CollectedPageOutput> = outputs
  const outputRecords: DomstackManifestRecord[] = pageData.outputRecords
  const outputCache: PageOutputCache = new Map<string, { hash: string, metadata: string }>()
  const written: Promise<DomstackManifestRecord[]> = writePageOutputs({
    dest: 'public',
    pageFilePath: 'public/index.html',
    page: { pageInfo: pageData.pageInfo, outputRecords },
    pageOutputs: outputs,
    outputCache,
  })
  const uncached: Promise<DomstackManifestRecord[]> = writePageOutputs({
    dest: 'public', pageFilePath: 'public/index.html', page: pageData, pageOutputs: [output],
  })
  // @ts-expect-error Emitted records describe files, not buffered output content.
  const bufferedContent = outputRecords[0]?.content
  // @ts-expect-error Hooks cannot access the internal emitted-file records.
  const hookRecords = page.outputRecords
  // @ts-expect-error Collection is streamed, not a promise of buffered records.
  const buffered: Promise<CollectedPageOutput[]> = pageData.collectPageOutputs()
  const iterator: PageOutputsFunction = async function * () { yield output }
  const promisedIterator: PageOutputsFunction = async () => (async function * () { yield output })()
  // @ts-expect-error Bare strings are not hook results.
  const badHook: PageOutputsFunction = () => 'html'
  // @ts-expect-error Content must be a string.
  const badOutput: PageOutput = { outputName: 'feed.json', content: {} }
  // @ts-expect-error Page metadata is read-only.
  page.url = '/other'
  // @ts-expect-error Source metadata is read-only.
  page.pageFile.filepath = '/other.md'
  // @ts-expect-error Hooks cannot render pages.
  page.renderFullPage()
  // @ts-expect-error Hooks cannot access a PageData instance.
  const bypass = page.pageInfo
  // @ts-expect-error Global data is only accessible through the subscribed params.data.
  const globalData = page.data
  // @ts-expect-error Vars are read-only.
  params.vars.title = 'other'
  // @ts-expect-error Only declared data is available.
  const secret = params.data.secret
  return { hook, params, outputs, normalized, iterable, outputRecords, outputCache, written, uncached, bufferedContent, hookRecords, buffered, collected, result, iterator, promisedIterator, badHook, badOutput, bypass, globalData, secret }
}
