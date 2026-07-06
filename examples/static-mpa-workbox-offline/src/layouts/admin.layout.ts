import type { HtmlResult } from 'fragtml/types.ts'
import type { LayoutFunction } from '@domstack/static/types.ts'
import type { StaticMpaWorkboxPageVars } from '#service-worker-settings'
import { renderPolicyLayout } from './render-policy-layout.ts'

/**
 * Layout for protected/admin routes.
 *
 * These pages are marked network-only by default so Workbox does not store or
 * replay potentially private content while offline.
 */
export const vars = {
  offline: false,
  precache: false,
} satisfies StaticMpaWorkboxPageVars

/** Render admin page chrome while reusing the shared demo layout template. */
const adminLayout: LayoutFunction<Record<string, unknown>, string | HtmlResult, string> = ({
  children,
  scripts,
  styles,
  vars,
}) => {
  return renderPolicyLayout({
    bodyClass: 'policy-layout policy-layout--admin',
    children,
    scripts,
    styles,
    title: vars.title ?? 'Admin route',
  })
}

export default adminLayout
