import type { HtmlResult } from 'fragtml/types.ts'
import type { LayoutFunction } from '@domstack/static/types.ts'
import type { StaticMpaOfflinePageVars } from '#service-worker-settings'
import { renderPolicyLayout } from './render-policy-layout.ts'

/**
 * Layout for pages that should become available offline only after a visit.
 *
 * The route is allowed offline, but is not install-time precached. The service
 * worker learns the page and same-route subresources through runtime caching.
 */
export const vars = {
  offline: true,
  precache: false,
} satisfies StaticMpaOfflinePageVars

/** Render progressive-cache page chrome while applying runtime-cache policy defaults. */
const progressiveCacheLayout: LayoutFunction<Record<string, unknown>, string | HtmlResult, string> = ({
  children,
  scripts,
  styles,
  vars,
}) => {
  return renderPolicyLayout({
    bodyClass: 'policy-layout policy-layout--progressive-cache',
    children,
    scripts,
    styles,
    title: vars.title ?? 'Progressive cache route',
  })
}

export default progressiveCacheLayout
