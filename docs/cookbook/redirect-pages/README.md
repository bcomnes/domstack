---
layout: docs
docsOrder: 134
docsParent: /docs/cookbook/
handlebars: false
---

# Generate redirect pages from page metadata

[All recipes](../)

See the working [blog example directory](https://github.com/bcomnes/domstack/tree/master/examples/blog/), [`redirects.pages.ts`](https://github.com/bcomnes/domstack/blob/master/examples/blog/src/redirects.pages.ts), and [`redirect.layout.ts`](https://github.com/bcomnes/domstack/blob/master/examples/blog/src/layouts/redirect.layout.ts).

Sites migrating from another platform often need redirect pages for old URLs that no longer exist.
Keep that history on the current page with `redirectFrom` metadata instead of maintaining a separate old/new mapping:

```md
---
title: Current Post
redirectFrom:
  - /2020/old-slug/
  - /blog/original-title/
---
<!-- src/blog/current-post.md -->

# Current Post
```

Collect the metadata in `global.data.ts`.
The current page's URL becomes the redirect target automatically:

```typescript
// src/global.data.ts
function collectRedirects (pages) {
  const redirects = []
  const redirectOwners = new Map()

  for (const page of pages) {
    const redirectFrom = page.vars.redirectFrom
    if (redirectFrom === undefined) continue

    const source = page.pageInfo.pageFile.relname
    if (!Array.isArray(redirectFrom)) throw new TypeError(`redirectFrom on "${source}" must be an array`)

    for (const from of redirectFrom) {
      if (typeof from !== 'string') throw new TypeError(`redirectFrom entries on "${source}" must be strings`)
      if (from.trim() !== from || !from.startsWith('/') || from.startsWith('//')) throw new Error(`Invalid redirectFrom "${from}" on "${source}": expected a same-origin URL path`)
      if (from.includes('?') || from.includes('#') || from.includes('\\') || from.split('/').some(part => part === '.' || part === '..')) throw new Error(`Invalid redirectFrom "${from}" on "${source}": unsupported URL path`)

      const existingSource = redirectOwners.get(from)
      if (existingSource) throw new Error(`redirectFrom "${from}" is declared by both "${existingSource}" and "${source}"`)

      redirectOwners.set(from, source)
      redirects.push({ from, to: page.pageInfo.url })
    }
  }

  return redirects
}

export default function globalData ({ pages }) {
  return { redirects: collectRedirects(pages) }
}
```

Validation happens while the destination page is still known, so malformed or duplicate metadata reports the page that declared it.
The pages factory then consumes the validated collection and renders each old location through a reusable redirect layout:

```typescript
// src/redirects.pages.ts
function redirectOutputName (from) {
  if (!from.startsWith('/') || from.startsWith('//')) throw new Error(`redirectFrom must be a same-origin URL path: ${from}`)
  if (from.includes('?') || from.includes('#')) throw new Error(`redirectFrom must not include a query or fragment: ${from}`)

  const relativePath = from.slice(1)
  if (relativePath.length === 0) return 'index.html'
  return relativePath.endsWith('/') ? `${relativePath}index.html` : relativePath
}

export const dataDeps = ['redirects']

export default function redirectsPages ({ data }) {
  const pages = []

  for (const { from, to } of data.redirects) {
    pages.push({
      outputName: redirectOutputName(from),
      vars: {
        layout: 'redirect',
        title: 'Redirecting...',
        redirectTo: to,
      },
    })
  }

  return pages
}
```

```typescript
// src/redirect.layout.ts

import { html, render } from 'fragtml'

export default function redirectLayout ({ vars }) {
  return render(html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="0;url=${vars.redirectTo}" />
  <link rel="canonical" href="${vars.redirectTo}" />
  <title>${vars.title}</title>
</head>
<body>
  <p>Redirecting to <a href="${vars.redirectTo}">${vars.redirectTo}</a></p>
</body>
</html>`)
}
```

`redirectFrom` contains old same-origin public URL paths.
`redirectOutputName()` converts directory URLs such as `/2020/old-slug/` to `2020/old-slug/index.html`.
DOMStack's generated-output validation still rejects escaping paths such as `..`.
The redirect target comes from the current page's normalized `pageInfo.url`, so moving the page again only requires retaining its previous URLs in that page's metadata.
`fragtml` escapes interpolated values by default, including attribute values and link text.

**SEO note:** Meta-refresh is a client-side redirect.
Search engines may not treat it as a permanent 301 redirect.
For static hosting platforms that support server-side redirects, you can instead generate a `_redirects` file (Netlify, Cloudflare Pages) or `vercel.json` (Vercel) using the object template type:

```typescript
// src/redirects-netlify.txt.template.ts
// Generates a _redirects file for Netlify / Cloudflare Pages.

export const dataDeps = ['redirects']

export default function ({ data }) {
  return {
    outputName: '_redirects',
    content: data.redirects.map(({ from, to }) => `${from}  ${to}  301`).join('\n'),
  }
}
```

Both approaches can coexist and consume the same `global.data.ts` redirect collection.
Copying a directory that contains a hand-crafted `_redirects` file via `--copy` is also an option when you prefer to manage redirects outside the build.
