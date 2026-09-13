import type {
  AsyncLayoutFunction,
  LayoutChain,
  LayoutChainVars,
  LayoutFunction,
  LayoutPageOutput,
  LayoutProvidedVars,
  LayoutRegistryName,
  LayoutRequiredVars,
  LayoutResult,
  PageForLayout,
} from '#types'

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false

// Conditional providers can produce distinct but structurally identical branches.
type Equivalent<Left, Right> = [Left] extends [Right]
  ? [Right] extends [Left] ? true : false
  : false

type Expect<Value extends true> = Value

type Frame = { html: string }
type RootData = { navigation: string[] }
type ArticleData = { recentPosts: string[] }
type PageData = { postBody: string }

type RootVars = {
  siteName: string
  theme: 'light' | 'dark'
  rootDefault: number
}

type ArticleVars = {
  theme: 'light' | 'dark'
  articleDefault: boolean
}

export const rootVars = {
  theme: 'light' as const,
  rootDefault: 1,
}

export const rootLayout: LayoutFunction<RootVars, Frame, Uint8Array, RootData> = ({ children }) => {
  return new TextEncoder().encode(children.html)
}

export const parentLayout = 'root'
export const articleVars = async () => ({
  theme: 'dark' as const,
  articleDefault: true,
})
export const articleLayout: AsyncLayoutFunction<ArticleVars, string, Frame, ArticleData> = async ({ children }) => ({
  html: `<article>${children}</article>`,
})

export const badChildLayout: LayoutFunction<{}, string, number> = () => 42
export const cyclicLayout: LayoutFunction<{}, string, string> = ({ children }) => children
export const incompatibleVars = { mode: 42 }
export const incompatibleVarsLayout: LayoutFunction<{ mode: string }, string, string> = ({ children }) => children
export const invalidVars = async () => 'not an object'
export const invalidVarsLayout: LayoutFunction<{}, string, string> = ({ children }) => children
export const dynamicParent: string = 'root'

export const narrowVarsLayout: LayoutFunction<{ x: 'narrow' }, string, string> = ({ children }) => children
export const wideVarsLayout: LayoutFunction<{ x: string }, string, string> = ({ children }) => children
export const numericVarsLayout: LayoutFunction<{ x: number }, string, string> = ({ children }) => children
export declare const possiblyUndefinedVars: { x: string } | undefined
export declare const optionalOverrideVars: { x?: number }
export declare const unionDefaults: { kind: 'text', text: string } | { kind: 'count', count: number }
export declare const unionRequirements: LayoutFunction<{ a: string } | { b: number }, string, string>
export declare const unionOverlap: LayoutFunction<{ x: string } | { x: number }, string, string>

// Source fixtures resolve through #types even when packed tests clean declarations.
declare module '#types' {
  interface LayoutRegistry {
    root: {
      vars: typeof rootVars
      render: typeof rootLayout
    }
    article: {
      parentLayout: typeof parentLayout
      vars: typeof articleVars
      render: typeof articleLayout
    }
    badChild: {
      parentLayout: 'root'
      render: typeof badChildLayout
    }
    orphan: {
      parentLayout: 'not-registered'
      render: typeof cyclicLayout
    }
    cycleA: {
      parentLayout: 'cycleB'
      render: typeof cyclicLayout
    }
    cycleB: {
      parentLayout: 'cycleA'
      render: typeof cyclicLayout
    }
    badVars: {
      vars: typeof incompatibleVars
      render: typeof incompatibleVarsLayout
    }
    invalidVars: {
      vars: typeof invalidVars
      render: typeof invalidVarsLayout
    }
    dynamicParent: {
      parentLayout: typeof dynamicParent
      render: typeof cyclicLayout
    }
    undefinedParent: {
      parentLayout: undefined
      render: typeof cyclicLayout
    }
    optionalUndefinedParent: {
      parentLayout?: undefined
      render: typeof cyclicLayout
    }
    possiblyRootParent: {
      parentLayout: 'root' | undefined
      render: typeof articleLayout
    }
    optionalRootParent: {
      parentLayout?: 'root'
      render: typeof articleLayout
    }
    unionParent: {
      parentLayout: 'undefinedParent' | 'optionalUndefinedParent'
      render: typeof cyclicLayout
    }
    possiblyUndefinedVars: {
      vars: typeof possiblyUndefinedVars
      render: typeof wideVarsLayout
    }
    optionalVars: {
      vars?: { x: string }
      render: typeof wideVarsLayout
    }
    narrowOuter: {
      render: typeof narrowVarsLayout
    }
    wideInner: {
      parentLayout: 'narrowOuter'
      render: typeof wideVarsLayout
    }
    wideOuter: {
      render: typeof wideVarsLayout
    }
    narrowInner: {
      parentLayout: 'wideOuter'
      render: typeof narrowVarsLayout
    }
    requiredDefault: {
      vars: { x: string }
      render: typeof cyclicLayout
    }
    optionalOverride: {
      parentLayout: 'requiredDefault'
      vars: typeof optionalOverrideVars
      render: typeof cyclicLayout
    }
    unionDefaults: {
      vars: typeof unionDefaults
      render: typeof cyclicLayout
    }
    unionDefaultsChild: {
      parentLayout: 'unionDefaults'
      vars: { child: boolean }
      render: typeof cyclicLayout
    }
    unionRequirements: {
      render: typeof unionRequirements
    }
    unionOverlap: {
      render: typeof unionOverlap
    }
    narrowedUnion: {
      parentLayout: 'unionOverlap'
      render: typeof wideVarsLayout
    }
    incompatibleRequirements: {
      parentLayout: 'wideOuter'
      render: typeof numericVarsLayout
    }
  }
}

export type _RegistryNames = Expect<Equal<
  LayoutRegistryName,
  | 'root' | 'article' | 'badChild' | 'orphan' | 'cycleA' | 'cycleB' | 'badVars' | 'invalidVars' | 'dynamicParent'
  | 'undefinedParent' | 'optionalUndefinedParent' | 'possiblyRootParent' | 'optionalRootParent' | 'unionParent'
  | 'possiblyUndefinedVars' | 'optionalVars' | 'narrowOuter' | 'wideInner' | 'wideOuter' | 'narrowInner'
  | 'requiredDefault' | 'optionalOverride' | 'unionDefaults' | 'unionDefaultsChild' | 'incompatibleRequirements'
    | 'unionRequirements' | 'unionOverlap' | 'narrowedUnion'
>>
export type _Chain = Expect<Equal<LayoutChain<'article'>, readonly ['root', 'article']>>
export type _PageOutput = Expect<Equal<LayoutPageOutput<'article'>, string>>
export type _OuterResult = Expect<Equal<LayoutResult<'article'>, Uint8Array>>

type Provided = LayoutProvidedVars<'article'>
export type _InnerDefaultWins = Expect<Equal<Provided['theme'], 'dark'>>
export type _RootDefaultRemains = Expect<Equal<Provided['rootDefault'], number>>
export type _ArticleDefaultRemains = Expect<Equal<Provided['articleDefault'], boolean>>
export type _RequiredExternally = Expect<Equal<LayoutRequiredVars<'article'>, { siteName: string }>>

type FinalVars = LayoutChainVars<
  'article',
  { siteName: string, theme: 'light' },
  { slug: string, theme: 'dark' }
>
export type _PageOverrideWins = Expect<Equal<FinalVars['theme'], 'dark'>>
export type _GlobalVarRemains = Expect<Equal<FinalVars['siteName'], string>>
export type _PageVarRemains = Expect<Equal<FinalVars['slug'], string>>

type ArticlePage = PageForLayout<
  'article',
  { slug: string },
  PageData,
  { siteName: string }
>
export type _PageDataOnly = Expect<Equal<Parameters<ArticlePage>[0]['data'], PageData>>

export const page: ArticlePage = ({ vars, data }) => {
  const values: [string, number, boolean, string] = [
    vars.siteName,
    vars.rootDefault,
    vars.articleDefault,
    vars.slug,
  ]
  const ownData: string = data.postBody
  // @ts-expect-error Ancestor layout data is not visible to the page.
  const ancestorData = data.navigation
  // @ts-expect-error Innermost layout data is not visible to the page.
  const layoutData = data.recentPosts
  return `${values.length}:${ownData}:${String(ancestorData)}:${String(layoutData)}`
}

// @ts-expect-error The innermost article layout requires string children.
export const wrongPageOutput: ArticlePage = () => ({ html: 'wrong level' })

export type _UndefinedParentIsRoot = Expect<Equal<LayoutChain<'undefinedParent'>, readonly ['undefinedParent']>>
export type _OptionalUndefinedParentIsRoot = Expect<Equal<
  LayoutChain<'optionalUndefinedParent'>,
  readonly ['optionalUndefinedParent']
>>
export type _PossiblyRootParentRejected = Expect<Equal<LayoutChain<'possiblyRootParent'>, never>>
export type _OptionalRootParentRejected = Expect<Equal<LayoutChain<'optionalRootParent'>, never>>
export type _UnionParentRejected = Expect<Equal<LayoutChain<'unionParent'>, never>>

export type _UndefinedDefaultsRemainPossible = Expect<Equal<
  LayoutProvidedVars<'possiblyUndefinedVars'>,
  {} | { x: string }
>>
export type _UndefinedDefaultsNotDefinitelySupplied = Expect<Equivalent<
  LayoutRequiredVars<'possiblyUndefinedVars'>,
  { x: string }
>>
export type _OptionalDefaultsNotDefinitelySupplied = Expect<Equivalent<LayoutRequiredVars<'optionalVars'>, { x: string }>>
export type _NarrowOuterWideInner = Expect<Equal<LayoutChainVars<'wideInner'>, { x: 'narrow' }>>
export type _WideOuterNarrowInner = Expect<Equal<LayoutChainVars<'narrowInner'>, { x: 'narrow' }>>
export type _NarrowOuterRequired = Expect<Equal<LayoutRequiredVars<'wideInner'>, { x: 'narrow' }>>
export type _NarrowInnerRequired = Expect<Equal<LayoutRequiredVars<'narrowInner'>, { x: 'narrow' }>>

export type _OptionalDefaultRetainsRequiredLeft = Expect<Equal<
  LayoutProvidedVars<'optionalOverride'>,
  { x: string | number }
>>
export type _OptionalPageOverrideRetainsRequiredLeft = Expect<Equal<
  LayoutChainVars<'undefinedParent', { x: string }, { x?: number }>,
  { x: string | number }
>>
export type _UnionDefaultsPreserveRightBranchKeys = Expect<Equal<
  LayoutProvidedVars<'unionDefaults'>,
  typeof unionDefaults
>>
export type _UnionDefaultsPreserveLeftBranchKeys = Expect<Equal<
  LayoutProvidedVars<'unionDefaultsChild'>,
  { kind: 'text', text: string, child: boolean } | { kind: 'count', count: number, child: boolean }
>>
export type _UnionDefaultsPreserveChainBranchKeys = Expect<Equal<
  LayoutChainVars<'unionDefaultsChild', {}, { page: string }>,
  | { kind: 'text', text: string, child: boolean, page: string }
  | { kind: 'count', count: number, child: boolean, page: string }
>>
export type _IncompatibleRequirementsVars = Expect<Equal<LayoutChainVars<'incompatibleRequirements'>, never>>
export type _IncompatibleRequirementsRequired = Expect<Equal<LayoutRequiredVars<'incompatibleRequirements'>, never>>
export type _IncompatibleRequirementsPage = Expect<Equal<PageForLayout<'incompatibleRequirements'>, never>>

export type _UnionSelectedNames = Expect<Equal<PageForLayout<'root' | 'article'>, never>>
export type _PartiallyMissingSelectedName = Expect<Equal<LayoutChain<'article' | 'missing'>, never>>
export type _DynamicSelectedName = Expect<Equal<PageForLayout<string>, never>>
export type _UnionRequiredVars = Expect<Equal<LayoutRequiredVars<'unionRequirements'>, { a: string } | { b: number }>>
export type _NarrowedUnionRequirements = Expect<Equal<LayoutChainVars<'narrowedUnion'>, { x: string }>>

export type _BadEdge = Expect<Equal<LayoutChain<'badChild'>, never>>
export type _BadPage = Expect<Equal<PageForLayout<'badChild'>, never>>
export type _MissingParent = Expect<Equal<LayoutChain<'orphan'>, never>>
export type _Cycle = Expect<Equal<LayoutChain<'cycleA'>, never>>
export type _UnknownLayout = Expect<Equal<PageForLayout<'does-not-exist'>, never>>
export type _IncompatibleDefaults = Expect<Equal<LayoutChainVars<'badVars'>, never>>
export type _InvalidVars = Expect<Equal<LayoutChain<'invalidVars'>, never>>
export type _DynamicParent = Expect<Equal<LayoutChain<'dynamicParent'>, never>>
export type _IncompatiblePageOverride = Expect<Equal<
  LayoutChainVars<'article', { siteName: string }, { theme: 123 }>,
  never
>>
