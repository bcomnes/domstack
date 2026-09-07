import type { PagesFunction } from '@domstack/static/types.js'
import type { RedirectPagesData } from './global.data.js'

type RedirectPageVars = {
  layout: 'redirect'
  title: string
  redirectTo: string
}

function redirectOutputName (from: string): string {
  if (!from.startsWith('/') || from.startsWith('//')) throw new Error(`redirectFrom must be a same-origin URL path: ${from}`)
  if (from.includes('?') || from.includes('#')) throw new Error(`redirectFrom must not include a query or fragment: ${from}`)

  const relativePath = from.slice(1)
  if (relativePath.length === 0) return 'index.html'
  return relativePath.endsWith('/') ? `${relativePath}index.html` : relativePath
}

export const dataDependencies = ['redirects'] satisfies Array<keyof RedirectPagesData>

const redirectPages: PagesFunction<
  RedirectPageVars,
  string,
  Record<string, never>,
  RedirectPagesData
> = ({ data }) => {
  const pages = []

  for (const { from, to } of data.redirects) {
    pages.push({
      outputName: redirectOutputName(from),
      vars: {
        layout: 'redirect' as const,
        title: 'Redirecting…',
        redirectTo: to,
      },
    })
  }

  return pages
}

export default redirectPages
