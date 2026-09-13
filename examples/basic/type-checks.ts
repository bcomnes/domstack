import type {
  LayoutChain,
  LayoutChainVars,
  LayoutProvidedVars,
  LayoutRequiredVars,
  PageForLayout,
  ValidatePageVars,
  GeneratedPageForLayout,
} from '@domstack/static/types.js'
import type globalVars from './src/global.vars.ts'
import type { vars as pageVars } from './src/js-page/page.js'
import type { vars as assetVars } from './src/js-page/loose-assets/page.ts'

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false

type Expect<Value extends true> = Value

type GlobalVars = Awaited<ReturnType<typeof globalVars>>
type ArticleDefaults = LayoutProvidedVars<'child'>
type ArticleResolved = LayoutChainVars<'child', GlobalVars, typeof pageVars>
type AssetResolved = LayoutChainVars<'root', GlobalVars, typeof assetVars>

export type SuppliedPageVars = Expect<Equal<ValidatePageVars<'child', typeof pageVars, GlobalVars>, typeof pageVars>>
export type MissingTitle = Expect<Equal<ValidatePageVars<'child', {}, GlobalVars>, never>>
export type MissingGlobalLocale = Expect<Equal<ValidatePageVars<'child', typeof pageVars, { siteName: string }>, never>>
export type GeneratedMissingTitle = Expect<Equal<GeneratedPageForLayout<'child', {}, Record<string, never>, GlobalVars>, never>>

export type Chain = Expect<Equal<LayoutChain<'child'>, readonly ['root', 'child']>>
export type GlobalTheme = Expect<Equal<GlobalVars['theme'], 'dark'>>
export type RootOverridesGlobal = Expect<Equal<AssetResolved['theme'], 'light'>>
export type ChildOverridesRoot = Expect<Equal<ArticleDefaults['theme'], 'dark'>>
export type PageOverridesChild = Expect<Equal<ArticleResolved['theme'], 'light'>>
export type ChildReadingTime = Expect<Equal<ArticleResolved['readingMinutes'], number>>
export type PageBadge = Expect<Equal<ArticleResolved['badge']['tone'], 'tip'>>
export type GlobalLocale = Expect<Equal<ArticleResolved['locale'], 'en'>>
export type GlobalNavigation = Expect<Equal<ArticleResolved['navigation'][number], { label: string, href: string }>>
export type PageTopics = Expect<Equal<ArticleResolved['topics'], string[]>>
export type AssetKinds = Expect<Equal<AssetResolved['assets'][number]['kind'], 'module' | 'stylesheet'>>
export type RequiredOutsideLayouts = Expect<Equal<
  LayoutRequiredVars<'child'>,
  { title: string, siteName: string, locale: 'en' | 'fr' }
>>

export type BadTheme = Expect<Equal<PageForLayout<'child', { theme: 'sepia' }>, never>>
export type BadReadingTime = Expect<Equal<PageForLayout<'child', { readingMinutes: string }>, never>>
// Vars merge shallowly: a page badge replaces the whole object, not just its label.
export type IncompleteBadge = Expect<Equal<PageForLayout<'child', { badge: { label: string } }>, never>>
export type NoChildVarsOnRoot = Expect<Equal<'readingMinutes' extends keyof AssetResolved ? true : false, false>>

export type ArticlePage = PageForLayout<'child', typeof pageVars, Record<string, never>, GlobalVars>
export type NoImplicitData = Expect<Equal<Parameters<ArticlePage>[0]['data'], Record<string, never>>>

// @ts-expect-error Pages must return a string or HtmlResult, not arbitrary objects.
export const invalidContent: ArticlePage = () => ({ html: 'not a HtmlResult' })
