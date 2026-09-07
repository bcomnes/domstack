import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { LayoutFunction, PageData } from '#types'
import type { ResolvedLayout } from '../../lib/build-pages/page-data.js'

type Vars = { title: string }
type Frame = { html: string }

const child: LayoutFunction<Vars, string, Frame> = async ({ children }) => ({ html: children })
const parent: LayoutFunction<Vars, Frame, string> = ({ children }) => children.html
const manual: LayoutFunction<Vars, string, string> = async args => parent({ ...args, children: await child(args) })

// The registry is heterogeneous: the parent consumes the child's output, not
// the original page result. These assignments are checked by the TS suite.
async function checkPageTypes (
  page: PageData<Vars, string, Frame>,
  root: ResolvedLayout<Vars, Frame, string>,
  article: ResolvedLayout<Vars, string, Frame>
) {
  await page.init({ layouts: { root, article } })
  const inner: string = await page.renderInnerPage({ pages: [page] })
  const full: string = await page.renderFullPage({ pages: [page] })
  return { inner, full }
}

test('layout types support async, heterogeneous, and manually composed render values', () => {
  assert.equal(typeof manual, 'function')
  assert.equal(typeof checkPageTypes, 'function')
})
