# DOMStack v12 release review

This document records the issues found while reviewing `12.0.0-beta.2` before the stable v12 release.

## Release blockers

### Resolved: watch builds can leave collection consumers stale

A targeted source-page rebuild recalculates `global.data`, but it only writes the directly affected page.
Other pages, templates, and generated pages may consume values derived from the changed page and remain stale.

This was reproduced with two Markdown pages and a `global.data.js` value derived from all page titles.
After changing one title, that page received the new collection value while the other page retained the old value.

The prerelease API allowed these dependency paths:

- A rendered page may consume values returned by `global.data`.
- A template may consume source pages, generated pages, or global data.
- A generated-pages factory may consume source pages or global data.
- A layout may inspect the complete page collection.
- `readMarkdownContent()`, `renderInnerPage()`, and `renderFullPage()` create content dependencies between outputs.

The resolved API removes raw page collections from ordinary consumers and routes intentional collection processing through `global.data.*`.

Blanket rebuilding every consumer would be correct but would defeat the purpose of granular rebuilds.
The branch now resolves this through the explicit subscription model described in [Declarative global-data dependencies](#declarative-global-data-dependencies).

### Layout watch mapping ignores builder vars and Markdown frontmatter

The watcher's page-to-layout map currently resolves only default, global, and `page.vars.*` values.
Actual page initialization also resolves builder variables, including Markdown frontmatter.

This was reproduced with a Markdown page that selects `layout: blog` through frontmatter.
Changing `blog.layout.js` did not rebuild that page, and its output remained byte-for-byte unchanged.

Successful page build reports already include the fully resolved `layoutName`.
The watcher should persist that result instead of independently approximating layout selection.

### Published declarations do not pass strict consumer validation

The published `12.0.0-beta.2` tarball was installed into a clean TypeScript consumer using NodeNext resolution and `skipLibCheck: false`.
Its declarations failed under TypeScript 5.9 and TypeScript 6.0.

The DOMStack-owned declaration errors are emitted for `htmlBuilder` and `mdBuilder`.
Their return types reference an undeclared generic named `T`.

The public declaration graph also exposes declaration errors from `cpx2`.
TypeScript 5.9 additionally reports a Markdown declaration incompatibility.

The repository's `skipLibCheck: true` setting masks these failures.
Release validation should pack the package, install it in a clean fixture, and type-check that fixture with `skipLibCheck: false`.

## Other findings

### Offline examples extend a nonexistent TypeScript configuration

Both new offline examples extend `../tsconfig.json`, but there is no `examples/tsconfig.json`.
They should extend `../../tsconfig.json`, matching the other examples.

The example build exits successfully while esbuild reports the missing configuration as a warning.
This means the examples currently build without their intended shared compiler settings.

Affected files:

- `examples/static-mpa-offline/tsconfig.json`
- `examples/static-mpa-workbox-offline/tsconfig.json`

### Production dependency audit reports a high-severity advisory

`npm audit --omit=dev` reports `deepmerge-ts <8.0.0` through the direct `write-package` dependency.
`write-package` is used only by the eject command.

The advisory concerns stack exhaustion while merging recursive object graphs, so exposure through parsed `package.json` data appears limited.
There is no automatic npm fix.
Replacing `write-package` or implementing the small package update directly would remove the known advisory from the production dependency graph.

## Declarative global-data dependencies

The original experimental implementation inferred output dependencies by wrapping page collections and vars in read-tracking proxies, then used async-local context to attribute reads during concurrent rendering.
That was mechanically capable but preserved the wrong public boundary: every consumer still received the complete page graph and therefore remained a potential collection consumer.

The replacement design makes collection processing an explicit phase:

- Only `global.data.*` receives source-backed `PageData[]`.
- `global.data.*` returns named top-level values for downstream use.
- Pages and layouts declare required keys in `vars.dataDeps`.
- Templates and `*.pages.*` factories declare required keys with a named `dataDeps` export.
- Consumers receive those values through a separate `data` argument rather than the ordinary variable cascade.
- Raw source or generated page collections are not passed to pages, layouts, templates, or generated-page factories.

The worker fingerprints every top-level global-data value during a build.
It compares those fingerprints with the previous successful watch state and invalidates only consumers subscribed to keys whose values changed.
Subscriptions are explicit records keyed by source page, generated output, template, or pages-file owner, so no async attribution or property-read graph is required.

Page dependencies are the union of declarations from frontmatter or page vars and the selected layout's vars.
The `dataDeps` metadata is removed before ordinary vars are exposed to rendering code.
Generated-page subscriptions retain their pages-file owner so changed factory data can rebuild the owner and reconcile obsolete outputs.

This model intentionally tracks at top-level global-data key granularity.
A consumer of `blogPosts` rebuilds when any part of that value changes, which is coarse enough to be dependable and narrow enough for the site-wide consumers that need collection data.
JSON-safe values receive stable fingerprints, while opaque or cyclic values conservatively invalidate their subscribers on every page build.
File imports remain covered by the existing static dependency maps, while untracked network, environment, or other external state must still cause its own source change or a broader rebuild.

The branch also retains the independent watch fixes that use successful page reports as the source of truth for layout routing and reconcile obsolete generated outputs by owner.

## Validation completed during review

- The repository was clean and synchronized with `origin/master`.
- The current HEAD GitHub test workflow was green.
- `npm test` passed the installed dependency check, ESLint, Node tests, Playwright, and TypeScript.
- `npm run build` passed.
- `npm run build-examples` passed with the two TypeScript configuration warnings described above.
- The actual published `12.0.0-beta.2` tarball was inspected and runtime-imported successfully.
- Clean tarball consumers were checked with TypeScript 5.9 and TypeScript 6.0.
- The production dependency audit was run.
- Both watch correctness bugs were independently reproduced.
