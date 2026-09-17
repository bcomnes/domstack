import type {
  GeneratedPageForLayout,
  LayoutFunction,
  PageForLayout,
  PageFunction,
  PageOutputsForRenderer,
  PageOutputsFunction,
} from '#types'

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false
type Expect<Value extends true> = Value

type Root = LayoutFunction<{ title: string }, string, string, { navigation: string[] }>
declare module '#types' {
  interface LayoutRegistry {
    outputsRoot: { render: Root, vars: { theme: 'dark', dataDeps: ['navigation'] } }
  }
}

type Article = PageForLayout<'outputsRoot', { title: string, slug: string }, { body: string }>
type Hook = PageOutputsForRenderer<Article>
export type SameContract = Expect<Equal<Hook, PageOutputsFunction<Parameters<Article>[0]['vars'], { body: string }>>>
export type InvalidRenderer = Expect<Equal<PageOutputsForRenderer<string>, never>>
export type InvalidParams = Expect<Equal<PageOutputsForRenderer<() => string>, never>>
export type NeverRenderer = Expect<Equal<PageOutputsForRenderer<never>, never>>
export type NoGeneratedHook = Expect<Equal<'pageOutputs' extends keyof GeneratedPageForLayout<'outputsRoot', { title: string }> ? true : false, false>>

export const outputs: Hook = ({ vars, data, page }) => {
  vars.theme satisfies 'dark'
  vars.slug.toUpperCase()
  data.body.toUpperCase()
  page.readMarkdownContent() satisfies Promise<string>
  // @ts-expect-error Vars are readonly.
  vars.title = 'changed'
  // @ts-expect-error Metadata is readonly.
  page.url = '/changed/'
  // @ts-expect-error Layout data is not page data.
  String(data.navigation)
  // @ts-expect-error Subscription metadata is not a variable.
  String(vars.dataDeps)
  // @ts-expect-error No rendering access.
  page.render()
  // @ts-expect-error No global data access.
  page.getData()
  // @ts-expect-error No client asset context.
  String(page.scripts)
  return { outputName: './article.json', content: JSON.stringify({ title: vars.title, body: data.body, url: page.url }) }
}

export const layoutOutputs: PageOutputsForRenderer<Root> = ({ vars, data }) => {
  data.navigation.map(String)
  // @ts-expect-error Page subscriptions are not layout subscriptions.
  String(data.body)
  return { outputName: './navigation.txt', content: vars.title }
}

export const explicitOutputs: PageOutputsForRenderer<PageFunction<{ count: number }, Uint8Array, { labels: string[] }>> = ({ vars, data }) => ({
  outputName: './count.txt', content: `${vars.count}:${data.labels.join(',')}`,
})
export const asyncOutputs: Hook = async () => []
export const streamedOutputs: Hook = async function * ({ vars }) {
  yield { outputName: './title.txt', content: vars.title }
}
// @ts-expect-error Additional outputs are strings regardless of the renderer output type.
export const invalidContent: Hook = () => ({ outputName: './binary', content: new Uint8Array() })
// @ts-expect-error Return [] instead of undefined to emit nothing.
export const invalidEmpty: Hook = () => undefined
export const restrictedContext: Hook = (params) => {
  // @ts-expect-error No layout children are passed to hooks.
  String(params.children)
  // @ts-expect-error No renderer styles are passed to hooks.
  String(params.styles)
  return []
}
