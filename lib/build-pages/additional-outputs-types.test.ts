import type {
  AdditionalOutput,
  AdditionalOutputProvenance,
  AdditionalOutputsFunction,
  AdditionalOutputsFunctionParams,
  AdditionalOutputsPage,
  AdditionalOutputsResult,
  CollectedAdditionalOutput,
  PageData,
} from '../../types.ts'
import { normalizeAdditionalOutputs } from './additional-outputs.js'

// Compile-only assertions for the public type entry and the narrow hook contract.
export function checkAdditionalOutputsTypes (pageData: PageData<{ title: string }>, page: AdditionalOutputsPage) {
  const output: AdditionalOutput = { outputName: 'feed.json', content: '' }
  const provenance: AdditionalOutputProvenance = { kind: 'layout', source: 'base.layout.ts', layoutName: 'base' }
  const collected: CollectedAdditionalOutput = { ...output, provenance }
  const result: AdditionalOutputsResult = [output]
  const hook: AdditionalOutputsFunction<{ title: string }, { posts: string[] }> = async ({ page, vars, data }) => ({
    outputName: 'feed.json', content: vars.title + page.url + data.posts.join(','),
  })
  const params: AdditionalOutputsFunctionParams<{ title: string }, { posts: string[] }> = { page, vars: { title: 'title' }, data: { posts: [] } }
  const outputs: AsyncGenerator<CollectedAdditionalOutput, void, unknown> = pageData.collectAdditionalOutputs()
  const normalized: AsyncGenerator<CollectedAdditionalOutput, void, unknown> = normalizeAdditionalOutputs(result, provenance)
  const iterable: AsyncIterable<CollectedAdditionalOutput> = outputs
  // @ts-expect-error Collection is streamed, not a promise of buffered records.
  const buffered: Promise<CollectedAdditionalOutput[]> = pageData.collectAdditionalOutputs()
  const iterator: AdditionalOutputsFunction = async function * () { yield output }
  const promisedIterator: AdditionalOutputsFunction = async () => (async function * () { yield output })()
  // @ts-expect-error Bare strings are not hook results.
  const badHook: AdditionalOutputsFunction = () => 'html'
  // @ts-expect-error Content must be a string.
  const badOutput: AdditionalOutput = { outputName: 'feed.json', content: {} }
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
  return { hook, params, outputs, normalized, iterable, buffered, collected, result, iterator, promisedIterator, badHook, badOutput, bypass, globalData, secret }
}
