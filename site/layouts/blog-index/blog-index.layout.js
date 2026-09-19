/**
 * @import { LayoutFunction } from '#types'
 */
import { html, raw, render } from 'fragtml'

export const parentLayout = 'root'

/** @type {LayoutFunction<Record<string, unknown>, string, string>} */
export default function blogIndexLayout ({ children }) {
  return render(html`<main class="blog-main" id="main-content"><div class="blog-column">${raw(children)}</div></main>`)
}
