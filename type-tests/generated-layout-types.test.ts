import type {
  GeneratedPageForLayout,
  LayoutFunction,
  PageForLayout,
  PagesForLayout,
  ValidatePageVars,
} from '#types'

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
(<T>() => T extends B ? 1 : 2) ? true : false
type Expect<T extends true> = T

export type Frame = { html: string }
export type Globals = { siteName: string, theme: 'light', globalOnly: number }
export type Supplied = { slug: string, theme: 'light', dataDeps: ['body'] }
export type FactoryData = { posts: string[] }
export type InlineData = { body: string }
export declare const genRoot: LayoutFunction<{
  siteName: string
  theme: 'light' | 'dark'
  rootDefault: number
}, Frame, string, { navigation: string[] }>
export declare const genArticle: LayoutFunction<{
  articleDefault: boolean
}, string, Frame, { recentPosts: string[] }>
export declare const genDefaults: () => Promise<{
  theme: 'dark'
  articleDefault: true
  dataDeps: ['recentPosts']
}>
export declare const genBadDefault: LayoutFunction<{ mode: string }, string, string>
export declare const genNull: LayoutFunction<{}, null, string>
export declare const genCallable: LayoutFunction<{}, (value: number) => string, string>
export declare const genPromise: LayoutFunction<{}, Promise<string>, string>
export declare const genAwaitable: LayoutFunction<{}, string | Promise<string>, string>
export declare const genObject: LayoutFunction<{}, Frame, string>
export declare const genMixedAwaitable: LayoutFunction<{}, number | Promise<string>, string>
export declare const genReserved: LayoutFunction<{ dataDeps: string[] }, string, string>

declare module '#types' {
  interface LayoutRegistry {
    genRoot: { render: typeof genRoot, vars: { rootDefault: number, theme: 'light' } }
    genArticle: { parentLayout: 'genRoot', render: typeof genArticle, vars: typeof genDefaults }
    genBadDefault: { render: typeof genBadDefault, vars: { mode: number } }
    genNull: { render: typeof genNull }
    genCallable: { render: typeof genCallable }
    genPromise: { render: typeof genPromise }
    genAwaitable: { render: typeof genAwaitable }
    genObject: { render: typeof genObject }
    genMixedAwaitable: { render: typeof genMixedAwaitable }
    genReserved: { render: typeof genReserved, vars: { dataDeps: string[] } }
  }
}

// Renderer requirements describe a baseline, not actual supplied values.
export type _BaselineExists = Expect<Equal<
  Parameters<PageForLayout<'genArticle'>>[0]['vars']['siteName'], string
>>
export type _MissingRequired = Expect<Equal<ValidatePageVars<'genArticle', {}>, never>>
export type _OptionalRequired = Expect<Equal<ValidatePageVars<'genArticle', { siteName?: string }>, never>>
export type _BadUnion = Expect<Equal<
  ValidatePageVars<'genArticle', { siteName: string } | { siteName: number }>, never
>>
export type _MissingUnionBranch = Expect<Equal<
  ValidatePageVars<'genArticle', { siteName: string } | { slug: string }>, never
>>
export type _AsyncDefaults = Expect<Equal<
  ValidatePageVars<'genArticle', { siteName: string }>, { siteName: string }
>>
export type _BadDefault = Expect<Equal<ValidatePageVars<'genBadDefault', {}>, never>>
export type _RepairedDefault = Expect<Equal<
  ValidatePageVars<'genBadDefault', { mode: string }>, { mode: string }
>>
export type _ExportPreserved = Expect<Equal<ValidatePageVars<'genArticle', Supplied, Globals>, Supplied>>
export type _ReservedCannotSupplyRenderer = Expect<Equal<
  ValidatePageVars<'genReserved', { dataDeps: string[] }>, never
>>
export type _GlobalSubscriptionsRejected = Expect<Equal<
  ValidatePageVars<'genArticle', Supplied, Globals & { dataDeps?: string[] }>, never
>>
export type _GlobalUnionSubscriptionsRejected = Expect<Equal<
  ValidatePageVars<'genArticle', Supplied, Globals | (Globals & { dataDeps: string[] })>, never
>>
export type _UnknownLayout = Expect<Equal<ValidatePageVars<'genUnknown', {}>, never>>
export type _MissingGeneratedVars = Expect<Equal<GeneratedPageForLayout<'genArticle'>, never>>
export type _MissingFactoryVars = Expect<Equal<PagesForLayout<'genArticle'>, never>>
export type _GeneratedGlobalSubscriptions = Expect<Equal<
  GeneratedPageForLayout<'genArticle', Supplied, InlineData, Globals & { dataDeps: [] }>, never
>>

export type Article = GeneratedPageForLayout<'genArticle', Supplied, InlineData, Globals>
export type Factory = PagesForLayout<'genArticle', Supplied, Globals, FactoryData, InlineData>
export type Inline = Extract<NonNullable<Article['children']>, (...args: never[]) => unknown>
export type InlineVars = Parameters<Inline>[0]['vars']
export type _LayoutLiteral = Expect<Equal<Article['vars']['layout'], 'genArticle'>>
export type _ExportSubscriptions = Expect<Equal<Article['vars']['dataDeps'], ['body']>>
export type _RenderSubscriptionsStripped = Expect<Equal<Extract<'dataDeps', keyof InlineVars>, never>>
export type _PageOverride = Expect<Equal<InlineVars['theme'], 'light'>>
export type _AsyncDefaultRetained = Expect<Equal<InlineVars['articleDefault'], true>>
export type _RootDefaultRetained = Expect<Equal<InlineVars['rootDefault'], number>>
export type _GlobalRetained = Expect<Equal<InlineVars['globalOnly'], number>>
export type _PageRetained = Expect<Equal<InlineVars['slug'], string>>
export type _FactoryVarsOnlyGlobals = Expect<Equal<Parameters<Factory>[0]['vars'], Globals>>
export type _FactoryData = Expect<Equal<Parameters<Factory>[0]['data'], FactoryData>>
export type _InlineData = Expect<Equal<Parameters<Inline>[0]['data'], InlineData>>
export type DefaultFactory = PagesForLayout<'genArticle', Supplied, Globals, FactoryData>
export type DefaultDefinition = Extract<Awaited<ReturnType<DefaultFactory>>, { vars: unknown }>
export type DefaultInline = Extract<NonNullable<DefaultDefinition['children']>, (...args: never[]) => unknown>
export type _NoFactoryDataInheritance = Expect<Equal<
  Parameters<DefaultInline>[0]['data'], Record<string, unknown>
>>

export const supplied: Article['vars'] = { layout: 'genArticle', slug: 'hello', theme: 'light', dataDeps: ['body'] }
export const staticPage: Article = { outputName: 'hello.html', draft: false, vars: supplied, children: 'Hello' }
export const omittedPage: Article = { vars: supplied }
export const nullPage: Article = { vars: supplied, children: null }
export const undefinedPage: Article = { vars: supplied, children: undefined }
export const inlinePage: Article = {
  vars: supplied,
  children: ({ vars, data }) => {
    // @ts-expect-error Subscription metadata is not a render variable.
    const subscriptions = vars.dataDeps
    // @ts-expect-error Factory subscriptions do not reach inline pages.
    const posts = data.posts
    // @ts-expect-error Root layout subscriptions do not reach inline pages.
    const navigation = data.navigation
    // @ts-expect-error Inner layout subscriptions do not reach inline pages.
    const recent = data.recentPosts
    return `${vars.siteName}:${vars.slug}:${data.body}:${subscriptions}:${posts}:${navigation}:${recent}`
  },
}
export const asyncInlinePage: Article = { vars: supplied, children: async ({ data }) => data.body }
export const repairedPage: GeneratedPageForLayout<'genBadDefault', { mode: string }> = {
  vars: { layout: 'genBadDefault', mode: 'fixed' }, children: 'ok',
}
// @ts-expect-error Generated pages always require vars, even when content may be omitted.
export const noVars: Article = { children: 'hello' }
// @ts-expect-error Runtime layout selection must be explicit.
export const noLayout: Article = { vars: { slug: 'hello', theme: 'light', dataDeps: ['body'] } }
// @ts-expect-error The selector must be the selected innermost layout literal.
export const wrongLayout: Article = { vars: { ...supplied, layout: 'genRoot' } }
// @ts-expect-error Supplied page vars remain required in each generated definition.
export const noSlug: Article = { vars: { layout: 'genArticle', theme: 'light', dataDeps: ['body'] } }
// @ts-expect-error Article children are strings, not outer-layout frames.
export const wrongChildren: Article = { vars: supplied, children: { html: 'wrong' } }
// @ts-expect-error Inline renderers must also satisfy the innermost children contract.
export const wrongInline: Article = { vars: supplied, children: () => 42 }
// @ts-expect-error Async inline results obey the same contract.
export const wrongAsyncInline: Article = { vars: supplied, children: async () => 42 }
// @ts-expect-error Static thenables require an inline renderer boundary.
export const staticPromise: Article = { vars: supplied, children: Promise.resolve('hello') }
// @ts-expect-error Output filenames are strings.
export const wrongOutputName: Article = { vars: supplied, outputName: 42 }

export type NullPage = GeneratedPageForLayout<'genNull'>
export const renderedNull: NullPage = { vars: { layout: 'genNull' }, children: () => null }
// Static null/undefined normalize to '', which a null-only layout cannot accept.
// @ts-expect-error Null-only layouts require explicit inline content.
export const omittedNull: NullPage = { vars: { layout: 'genNull' } }
// @ts-expect-error Static null means empty string, not a null render result.
export const staticNull: NullPage = { vars: { layout: 'genNull' }, children: null }
// @ts-expect-error Static undefined also means empty string.
export const staticUndefined: NullPage = { vars: { layout: 'genNull' }, children: undefined }
export const callableChild = (value: number): string => String(value)
export const wrappedCallable: GeneratedPageForLayout<'genCallable'> = {
  vars: { layout: 'genCallable' }, children: () => callableChild,
}
// @ts-expect-error A callable child must be wrapped so it is not invoked as a renderer.
export const bareCallable: GeneratedPageForLayout<'genCallable'> = { vars: { layout: 'genCallable' }, children: callableChild }
export type _AwaitedBoundary = Expect<Equal<GeneratedPageForLayout<'genPromise'>, never>>
export const awaitablePage: GeneratedPageForLayout<'genAwaitable'> = {
  vars: { layout: 'genAwaitable' }, children: async () => 'awaited',
}
// @ts-expect-error Even promise-accepting layouts must use an inline renderer for promises.
export const awaitableStatic: GeneratedPageForLayout<'genAwaitable'> = { vars: { layout: 'genAwaitable' }, children: Promise.resolve('hello') }

// Structural object matches must not bypass runtime invocation or awaiting.
export type ObjectPage = GeneratedPageForLayout<'genObject'>
export const plainObjectPage: ObjectPage = { vars: { layout: 'genObject' }, children: { html: 'ok' } }
export const inlineObjectPage: ObjectPage = { vars: { layout: 'genObject' }, children: () => ({ html: 'ok' }) }
export const callableObject = Object.assign(() => 42, { html: 'ok' })
export const thenableObject = Object.assign(Promise.resolve(42), { html: 'ok' })
// @ts-expect-error Runtime invokes this callable and gets a number, not a Frame.
export const staticCallableObjectPage: ObjectPage = { vars: { layout: 'genObject' }, children: callableObject }
// @ts-expect-error Runtime awaits this thenable and gets a number, not a Frame.
export const staticThenableObjectPage: ObjectPage = { vars: { layout: 'genObject' }, children: thenableObject }
// @ts-expect-error Returning a structural thenable still awaits to the wrong type.
export const inlineThenableObjectPage: ObjectPage = { vars: { layout: 'genObject' }, children: () => thenableObject }

// Filter unsafe awaited branches without discarding safe siblings in the union.
export type MixedAwaitablePage = GeneratedPageForLayout<'genMixedAwaitable'>
export const mixedStaticPage: MixedAwaitablePage = { vars: { layout: 'genMixedAwaitable' }, children: 42 }
export const mixedInlinePage: MixedAwaitablePage = { vars: { layout: 'genMixedAwaitable' }, children: () => 42 }
// @ts-expect-error Awaiting Promise<string> produces a string outside the children contract.
export const mixedPromisePage: MixedAwaitablePage = { vars: { layout: 'genMixedAwaitable' }, children: Promise.resolve('unsafe') }
// @ts-expect-error An inline renderer cannot restore the unsafe promise branch.
export const mixedAsyncPage: MixedAwaitablePage = { vars: { layout: 'genMixedAwaitable' }, children: async () => 'unsafe' }

export const syncFactory: Factory = ({ vars, data }) => {
  // @ts-expect-error Factory vars do not contain layout defaults.
  const defaultValue = vars.articleDefault
  // @ts-expect-error Factory vars do not contain supplied inline-page vars.
  const slug = vars.slug
  // @ts-expect-error Inline subscriptions do not reach the factory.
  const body = data.body
  // @ts-expect-error Layout subscriptions do not reach the factory.
  const navigation = data.navigation
  return { ...staticPage, children: `${vars.siteName}:${data.posts.length}:${defaultValue}:${slug}:${body}:${navigation}` }
}
export const arrayFactory: Factory = () => [staticPage, inlinePage]
export const asyncFactory: Factory = async () => [staticPage, asyncInlinePage]
export const asyncSingleFactory: Factory = async () => staticPage
export const generatorFactory: Factory = async function * () { yield staticPage; yield inlinePage }
export const iterableFactory: Factory = params => generatorFactory(params)
export const nullFactory: Factory = () => null
export const undefinedFactory: Factory = () => undefined
export const asyncNullFactory: Factory = async () => null
export const asyncUndefinedFactory: Factory = async () => undefined
export type _ResultEnvelope = Expect<Equal<
  Awaited<ReturnType<Factory>>, Article | Article[] | AsyncIterable<Article> | null | undefined
>>
// @ts-expect-error A result is a definition or collection, not raw rendered content.
export const rawFactory: Factory = () => 'hello'
// @ts-expect-error Every array member must be a valid definition.
export const badArrayFactory: Factory = () => [staticPage, { children: 'missing vars' }]
// @ts-expect-error Async results must retain the literal layout selector.
export const badAsyncFactory: Factory = async () => ({ vars: { ...supplied, layout: 'genRoot' } })
// @ts-expect-error Async generators must yield valid definitions.
export const badGeneratorFactory: Factory = async function * () { yield { vars: supplied, children: 42 } }
// @ts-expect-error Synchronous iterators are not supported factory result envelopes.
export const syncGeneratorFactory: Factory = function * () { yield staticPage }
// @ts-expect-error A pages property is not a supported result envelope.
export const objectEnvelopeFactory: Factory = () => ({ pages: [staticPage] })
