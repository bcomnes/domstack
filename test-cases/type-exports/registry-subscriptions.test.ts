import type {
  LayoutChainVars,
  LayoutFunction,
  LayoutProvidedVars,
  LayoutRequiredVars,
  PageForLayout,
  ValidatePageVars,
} from '#types'

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false

type Expect<Value extends true> = Value

declare module '#types' {
  interface LayoutRegistry {
    subscriptionsRoot: {
      render: LayoutFunction<{ title: string }, string, string>
      vars: { rootOnly: number, dataDeps: ['navigation'] }
    }
    subscriptionsChild: {
      parentLayout: 'subscriptionsRoot'
      render: LayoutFunction<{ title: string }, string, string>
      vars: () => Promise<{ showSidebar: boolean, dataDeps: ['related'] }>
    }
    subscriptionsUnion: {
      render: LayoutFunction<{}, string, string>
      vars: { kind: 'a', a: string, dataDeps: ['a'] } | { kind: 'b', b: number, dataDeps: ['b'] }
    }
    subscriptionsRequiredMetadata: {
      render: LayoutFunction<{ dataDeps: string[] }, string, string>
      vars: { dataDeps: ['navigation'] }
    }
    subscriptionsOptionalMetadata: {
      render: LayoutFunction<{ title: string, dataDeps?: string[] }, string, string>
    }
  }
}

type Supplied = { title: string, dataDeps: ['body'] }
type Article = PageForLayout<'subscriptionsChild', Supplied, { body: string }>
type FinalVars = Parameters<Article>[0]['vars']

export type NoPageMetadata = Expect<Equal<'dataDeps' extends keyof FinalVars ? true : false, false>>
export type NoProvidedMetadata = Expect<Equal<
  LayoutProvidedVars<'subscriptionsChild'>,
  { rootOnly: number, showSidebar: boolean }
>>
export type RequiredTitleOnly = Expect<Equal<LayoutRequiredVars<'subscriptionsChild'>, { title: string }>>
export type PageTitle = Expect<Equal<FinalVars['title'], string>>
export type OwnData = Expect<Equal<Parameters<Article>[0]['data'], { body: string }>>
export type ExportMetadataRetained = Expect<Equal<ValidatePageVars<'subscriptionsChild', Supplied>, Supplied>>
export type UnionDefaultsPreserved = Expect<Equal<
  LayoutProvidedVars<'subscriptionsUnion'>,
  { kind: 'a', a: string } | { kind: 'b', b: number }
>>
export type UnionPageVarsPreserved = Expect<Equal<
  LayoutChainVars<'subscriptionsUnion', {}, { page: number, dataDeps: ['page'] }>,
  { kind: 'a', a: string, page: number } | { kind: 'b', b: number, page: number }
>>
export type NoRequiredMetadata = Expect<Equal<LayoutRequiredVars<'subscriptionsRequiredMetadata'>, never>>
export type ImpossibleRenderer = Expect<Equal<PageForLayout<'subscriptionsRequiredMetadata'>, never>>
export type NoOptionalMetadata = Expect<Equal<
  LayoutChainVars<'subscriptionsOptionalMetadata', {}, Supplied>,
  { title: string }
>>
export type GlobalMetadataRejected = Expect<Equal<
  LayoutChainVars<'subscriptionsChild', { dataDeps: ['global'] }, Supplied>, never
>>

export const render: Article = ({ vars, data }) => {
  // @ts-expect-error Runtime strips page and layout subscription metadata.
  const subscriptions = vars.dataDeps
  return `${vars.title}:${data.body}:${subscriptions}`
}
