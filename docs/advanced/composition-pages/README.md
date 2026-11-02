---
layout: docs
docsOrder: 126
docsParent: /docs/advanced/
handlebars: false
---

# Composition pages

Name a source page with `.compose` before its extension to keep it available as composition content without automatically publishing its page-owned output.
For example, `src/introduction/page.compose.md` can contain:

```markdown
---
title: Shared introduction
---

Content to render inside another page or collect through global data.
```

## Filenames and metadata

Composition filenames follow the normal [page file](../../pages/#page-files) conventions:

| Page kind | Composition filename |
|---|---|
| Directory Markdown page | `page.compose.md` or `README.compose.md` |
| Directory HTML page | `page.compose.html` |
| Directory JavaScript or TypeScript page | `page.compose.js` or `page.compose.ts` |
| Loose Markdown page | `chapter.compose.md` |

The `.compose` marker applies to supported page extensions, not just Markdown.
[`PageInfo.compose`](../../data/#page-metadata) is a boolean determined once at discovery: `true` for composition pages and `false` for ordinary standalone pages.
Global, layout, companion, and builder variables cannot override this classification, and it is not inherited from a directory or layout.
`compose` is not a special page variable; `vars.compose` is ordinary user data and does not control output.
There is no CLI toggle for composition.

## Automatic output

Composition pages suppress all automatic page-owned output: the primary HTML file, all page and layout [`pageOutputs`](../../pages/#page-outputs) hooks, and the page's `workers.json` file.
Static asset copying and bundle generation are unchanged, including colocated styles, client bundles, and worker bundles.
Their URLs and output paths remain metadata, not a guarantee that files are published.

## Drafts

[Draft inclusion](../../pages/#draft-pages) and composition are independent.
For a composition draft, the only combined suffix order is `.compose.draft.ext`, such as `page.compose.draft.md`, `README.compose.draft.md`, or `chapter.compose.draft.md`.
Do not use `.draft.compose.ext`.

| Source filename | Default build | With `--drafts` |
|---|---|---|
| `page.md` | Available; automatic page-owned output | Available; automatic page-owned output |
| `page.draft.md` | Ignored | Available; automatic page-owned output |
| `page.compose.md` | Available for composition; no automatic page-owned output | Available for composition; no automatic page-owned output |
| `page.compose.draft.md` | Ignored | Available for composition; no automatic page-owned output |

Enabling drafts does not turn a composition page into a standalone page.

## Global data and explicit rendering

Source-backed composition pages remain available to [`global.data.ts`](../../data/#global-data), unless excluded as drafts.
They support explicit calls to `renderInnerPage()` or `renderFullPage()`, subject to the normal [data-subscription rules](../../data/#rendering-page-content).
Explicit rendering returns content without publishing the page or running its `pageOutputs` hooks.
Use `page.pageInfo.compose` to select fragments or standalone pages:

```typescript
// Inside global.data.ts.
const fragments = pages.filter(page => page.pageInfo.compose === true)
const standalonePages = pages.filter(page => page.pageInfo.compose === false)
```

Do not assume a page's URL means that it is published.

## Generated pages

[Generated page definitions](../../generation/#generated-page-definitions) use the optional top-level boolean `compose`, parallel to `draft`, defaulting to `false`:

```typescript
// src/introduction.pages.ts
export default {
  outputName: 'introduction/index.html',
  compose: true,
  draft: false,
  vars: { title: 'Shared introduction' },
  children: '<p>Shared content</p>',
}
```

The definition's `compose` field sets `PageInfo.compose`; `vars.compose` does not control output.
`compose: true` suppresses automatic page-owned output without changing bundle generation or static asset copying.
Generated pages remain downstream of global data and are not added to its source-backed `PageData[]` collection, regardless of `compose`.
Their URLs and output paths remain metadata even when no page file is published.
