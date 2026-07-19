import type { HtmlResult } from 'fragtml/types.ts'
import type { LayoutFunction } from '@domstack/static/types.ts'
import type { StaticMpaWorkboxPageVars } from '#service-worker-settings'
import { renderPolicyLayout } from './render-policy-layout.ts'

/**
 * Default layout for public offline-first pages.
 *
 * Pages using this layout are included in the generated Workbox precache by
 * default, so they should be safe to serve immediately while offline.
 */
export const vars = {
  offline: true,
  precache: true,
} satisfies StaticMpaWorkboxPageVars

/** Render the normal public page chrome and apply the shared navigation wrapper. */
const rootLayout: LayoutFunction<Record<string, unknown>, string | HtmlResult, string> = ({
  children,
  scripts,
  styles,
  vars,
}) => {
  return renderPolicyLayout({
    bodyClass: 'policy-layout policy-layout--root',
    children,
    scripts,
    styles,
    title: vars.title ?? 'Static MPA offline example',
  })
}

export default rootLayout
