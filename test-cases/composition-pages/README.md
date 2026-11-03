# Composition pages

The homepage subscribes to `global.data.js`, which collects the inner Markdown bodies of two slides identified by `.compose.md` filenames and introspects every page's resolved `pageInfo.compose`.
It also includes an explicitly rendered full slide preview to demonstrate that composition pages suppress automatic publication, not rendering APIs or layout application.
The shared layout and slide `pageOutputs` hooks reject accidental calls for composition pages.
Neither slide publishes its primary HTML or sidecars, while the homepage and the explicit/default non-composition pages publish HTML and layout metadata normally.

Run the acceptance test from the repository root:

```sh
node --test test-cases/composition-pages/index.test.js
```

The test checks content, missing outputs, the output manifest, and per-page ownership reports without depending on static asset copying.
