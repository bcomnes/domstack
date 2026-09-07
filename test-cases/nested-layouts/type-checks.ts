// Compile-time regressions exercised by npm run test:tsc, not the Node test runner.
import type { LayoutFunction, PageData, PageFunction } from '#types'
import type { ResolvedLayout } from '../../lib/build-pages/page-data.js'
import { pageWriter } from '../../lib/build-pages/page-builders/page-writer.js'

type Vars = { title: string }
type Frame = { html: string }

const child: LayoutFunction<Vars, string, Frame> = async ({ children }) => ({ html: children })
const parent: LayoutFunction<Vars, Frame, string> = ({ children }) => children.html
const manual: LayoutFunction<Vars, string, string> = async args => parent({ ...args, children: await child(args) })

// The registry is heterogeneous: the parent consumes the child's output, not
// the original page result. These assignments are checked by the TS suite.
async function checkPageTypes (
  page: PageData<Vars, string, Frame, { greeting: string }>,
  objectPage: PageData<Vars, Frame, string>,
  root: ResolvedLayout<Vars, Frame, string, { navigation: string }>,
  article: ResolvedLayout<Vars, string, Frame, { recentPosts: string[] }>
) {
  await page.init({ layouts: { root, article } })
  const inner: string = await page.renderInnerPage()
  const full: string = await page.renderFullPage()
  const objectInner: Frame = await objectPage.renderInnerPage()
  await pageWriter({ dest: 'unused', page })
  // Heterogeneous collections do not erase the individual page's render type.
  // @ts-expect-error A string-rendering page does not return a Frame.
  const invalidInner: Frame = await page.renderInnerPage()
  return { inner, full, objectInner, invalidInner }
}

// Explicit renderer contracts still reject incompatible values at module boundaries.
// @ts-expect-error This page promises a Frame, not a string.
const invalidPage: PageFunction<Vars, Frame> = () => 'wrong'
// @ts-expect-error This layout receives a Frame, not a string.
const invalidLayout: LayoutFunction<Vars, Frame, string> = ({ children }) => children.toUpperCase()
// @ts-expect-error This layout promises a Frame, not a string.
const invalidResult: LayoutFunction<Vars, string, Frame> = ({ children }) => children

export { manual, checkPageTypes, invalidPage, invalidLayout, invalidResult }
