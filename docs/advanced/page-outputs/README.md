---
layout: docs
docsOrder: 127
docsParent: /docs/advanced/
handlebars: false
---

# Page outputs

Use `pageOutputs` to publish extra files for a source-backed page, such as a Markdown download or a JSON metadata file alongside its HTML.
Export this function from a JS/TS page module, the page's directly associated vars companion, or a [layout](../../layouts/#page-outputs).
DOMStack calls the function during the page build and writes the files it returns.
Return output records rather than writing to the destination yourself.
See [Pages](../../pages/) for core page authoring, including page files, variables, and colocated assets.

For example, this page subscribes to `siteMetadata` returned by [`global.data.ts`](../../data/#global-data) and writes `article/metadata.json` beneath the destination as well as its normal HTML:

```js
// src/article/page.js
export const vars = {
  title: 'An article',
  dataDeps: ['siteMetadata'],
}

export default ({ vars }) => `<h1>${vars.title}</h1>`

export const pageOutputs = ({ vars, data }) => ({
  outputName: './metadata.json',
  content: JSON.stringify({ title: vars.title, site: data.siteMetadata }),
})
```

## Companion hooks

For Markdown and HTML pages, put `pageOutputs` in the adjacent `page.vars.js` or `page.vars.ts` companion.
Keep page variables in the companion's default export and export the hook separately:

```js
// src/article/page.vars.js (alongside page.md)
export default { title: 'An article' }

export async function* pageOutputs ({ page, vars }) {
  yield {
    outputName: './source.md',
    content: await page.readMarkdownContent(),
  }
  yield {
    outputName: './metadata.json',
    content: JSON.stringify({ title: vars.title }),
  }
}
```

For an HTML page, use the same companion export to return text or JSON rather than calling the Markdown-only `readMarkdownContent()` method.
JS/TS pages can also use a vars companion.
Only the directly associated companion provides a page-level hook; global vars and inherited directory vars do not provide hooks.
If both a JS/TS page module and its companion export `pageOutputs`, DOMStack uses the page module's hook and warns with both provider names.
The companion's hook does not run, but applicable layout hooks still run.

## Hook arguments and results

Every hook receives `{ page, vars, data }`:

- `page` is a read-only handle to the current source page, including `type`, `path`, `url`, `outputName`, `outputRelname`, `draft`, `compose`, and read-only `pageFile` metadata.
  Its `readMarkdownContent()` method reads the Markdown body with YAML frontmatter removed, without rendering Markdown, substituting Handlebars, or rewriting links.
  The method throws for non-Markdown pages.
- `vars` contains the fully resolved page variables and is read-only.
- `data` contains only the declaring renderer's subscribed global data.
  Page-module and companion hooks share the page renderer's subscriptions; each layout hook shares that specific layout renderer's subscriptions.
  Declare required keys through the renderer's existing `vars.dataDeps`, `dataDeps` in a companion's default vars object, or page frontmatter.
  Each layout declares its own keys through its `vars.dataDeps`.
  Undeclared keys are unavailable, even if another hook subscribes to them.
  See [Data subscriptions](../../data/#data-subscriptions).

A hook returns one `{ outputName: string, content: string }` record, an array of records, or an async iterable of records, directly or through a promise.
Use a single record for one file, an array for a fixed set, or an async generator to produce files incrementally.
`outputName` must be a non-empty file path, and `content` must be a string; serialize JSON with `JSON.stringify()`.
Bare strings, `null`, and `undefined` are not valid results.
Return `[]` or yield no records when the hook has no files to produce.

## Composition and opt-out

Applicable hooks run in outermost layout → innermost layout → selected page-level hook order.
Layout outputs and page-level outputs are additive; the page hook does not replace layout outputs.
Returning `[]` from the page hook only skips that hook's files.
To let a page opt out of a layout's files, have the layout inspect a resolved variable such as `rawExport: false` and return `[]` itself, as in the [layout example](../../layouts/#page-outputs).
Each layout that supports the opt-out must check that variable.

Hooks run only when building the owning page's output, not when collection or global-data code calls `renderInnerPage()` or `renderFullPage()`.
[Composition pages](../composition-pages/) skip all page and layout hooks along with the page's other automatic output.
Support for generated `*.pages.*` pages is deferred; those pages skip all `pageOutputs` hooks, including inherited layout hooks.

## Streaming results

DOMStack consumes records sequentially rather than buffering all hook results.
It validates each record and its destination, then writes the file or retains an unchanged file before requesting the next record.
An async generator resumes after `yield` only once that file has been processed, so it can release resources before preparing the next one.
Arrays use the same per-record processing, but the hook must create the array before returning it.
A later layout or page hook starts only after the preceding hook's files have been processed.

## Page-output types

Import `PageOutputsFunction<T, D>` from `@domstack/static/types.js` to type a hook, where `T` is the resolved variables shape and `D` is the declaring renderer's subscribed data shape:

```ts
// src/article/page.vars.ts
import type { PageOutputsFunction } from '@domstack/static/types.js'

type ArticleVars = { title: string }
type ArticleData = { siteMetadata: { name: string } }

export default {
  title: 'An article',
  dataDeps: ['siteMetadata'],
}

export const pageOutputs: PageOutputsFunction<ArticleVars, ArticleData> = ({ vars, data }) => ({
  outputName: './metadata.json',
  content: JSON.stringify({ title: vars.title, site: data.siteMetadata.name }),
})
```

`PageOutput` types an individual output record, and `PageOutputsResult` describes the record, array, or async iterable returned by a hook.
`PageOutputsFunctionParams<T, D>` types the argument object, and `PageOutputsPage` types its read-only `page` handle.
Types describe the values but do not subscribe to global data; keep the runtime `dataDeps` declaration.

## Output paths and failures

Output names resolve beneath the configured destination, including custom destinations:

| Output name | Resolution for a page at `docs/article/index.html` |
| --- | --- |
| `metadata.json` or `./metadata.json` | `docs/article/metadata.json` |
| `../source/article.md` | `docs/source/article.md` |
| `/raw/article.md` | `raw/article.md` at the destination root |

A leading `/` means destination-root-relative, never filesystem-absolute.
Relative paths use the current page's output directory even when a layout declares them.
Parent traversal is allowed only while the resolved target remains inside the destination.
Use portable file names; drive-letter paths, UNC paths, reserved names, and paths ending in a separator are invalid.
Targets that escape the destination, traverse symlinks, or name a directory instead of a file fail the build.

Duplicate destinations produce best-effort warnings based on build output reports, including exact duplicates between hooks and conflicts with normal HTML, other pages, templates, copied assets, or bundles.
They do not reject the build, even when content differs.
Watch warnings cover outputs observed in the current page/template phase and may miss conflicts with files from earlier builds or names that differ only in case.
Choose unique destinations; do not rely on write order or cleanup behavior for conflicting outputs.

Page outputs are written directly to the destination as their records arrive.
If a later hook, iterator step, output validation, or write fails, earlier writes remain, including updates to existing files and newly created files.
Processing stops at the failure without requesting subsequent records or invoking later hooks.
Async generators can use `try`/`finally` to release resources when iteration stops.
The page's HTML is rendered before its hooks run and written only after they succeed, so a hook failure leaves any previous HTML in place.
Writes are not transactional and are not rolled back: other pages and build phases may already have written their outputs, and filesystem write failures can leave partial updates.

## Watch behavior and ownership

Page outputs belong to the source page and appear in page build reports and, when enabled, the build manifest with kind `page-output`.
Ownership tracking and cleanup also work when public build-manifest generation is disabled.
A failed build retains previously tracked files and tracks any files successfully written or retained unchanged before the failure; it does not clean up the page's old outputs.
After a successful rebuild, DOMStack removes previously owned files no longer returned, including renamed outputs, files from removed hooks, and partial outputs retained from failed attempts.
Files written before a failure are tracked even when the initial watch build fails, so recovery, hook removal, or source deletion can clean them up.
Source deletion, source rename, or draft exclusion also removes the page's old outputs.
Adding, editing, removing, or renaming a companion updates the owning page's hook and output set.

Hooks rerun when the owning page rebuilds, including changes to applicable page or layout data subscriptions.
A dependency used only by a hook still triggers an HTML rebuild because both outputs rebuild together.
During watch rebuilds, DOMStack skips rewriting a previously written page output when its content matches and the destination's filesystem metadata has not changed.
These unchanged files remain owned by the page and keep their modification times.
Missing files or files with changed metadata are written again.
On a fresh build, page outputs are written even if identical files already exist.

An article body edit can update that article's HTML and Markdown download without rebuilding sibling pages, while a shared data change can rerun affected hooks without rewriting their unchanged files.
Use [templates](../../generation/#templates) for collection-wide search indexes and feeds, and page outputs for per-page files.
