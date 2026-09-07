// Compile-time regressions exercised by npm run test:tsc, not the Node test runner.
import type {
  DataDeps,
  GlobalDataFunction,
  LayoutFunction,
  PageFunction,
  PagesFunction,
  TemplateFunction,
} from '#types'

declare function expectType<T> (value: T): void

type Vars = { title: string }
type FactoryData = { slugs: string[] }
type PageData = { greeting: string }
type LayoutData = { navigation: string }

const factoryDeps = ['slugs'] as const satisfies DataDeps<FactoryData>
const pageDeps = ['greeting'] as const satisfies DataDeps<PageData>
// @ts-expect-error - Declarations must name keys in the consumer's contract.
const invalidDeps: DataDeps<FactoryData> = ['greeting']

const page: PageFunction<Vars, { html: string }, PageData> = ({ data }) => ({ html: data.greeting })
const layout: LayoutFunction<Vars, { html: string }, string, LayoutData> = ({ data, children }) => data.navigation + children.html
const template: TemplateFunction<Vars, PageData> = ({ data }) => data.greeting
const asyncTemplate: TemplateFunction<Vars, PageData> = async ({ data }) => data.greeting

const factory: PagesFunction<Vars & { dataDeps: typeof pageDeps }, { html: string }, Vars, FactoryData, PageData> = ({ data }) => {
  // @ts-expect-error - Factories do not receive their inline pages' data.
  expectType<undefined>(data.greeting)
  return data.slugs.map(slug => ({
    outputName: `${slug}.html`,
    vars: { title: slug, dataDeps: pageDeps },
    children: page,
  }))
}

const noPages: PagesFunction = () => undefined
const asyncNoPages: PagesFunction = async () => null
const globalData: GlobalDataFunction<FactoryData, Vars, { html: string }> = async ({ pages }) => {
  for (const source of pages) {
    const html: string = (await source.renderInnerPage()).html
    // @ts-expect-error - The source-page vars contract is explicit.
    expectType<undefined>(source.vars.missing)
    expectType<string>(html)
    // @ts-expect-error - The producer's source render type must not widen to any.
    expectType<number>((await source.renderInnerPage()).html)
  }
  return { slugs: pages.map(source => source.vars.title) }
}

export { factoryDeps, invalidDeps, page, layout, template, asyncTemplate, factory, noPages, asyncNoPages, globalData }
