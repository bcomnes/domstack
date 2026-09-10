---
layout: docs
docsOrder: 120
handlebars: false
---

# API

Import `DomStack` from `@domstack/static` to build sites from your own Node.js scripts.
For automated tests, `testBuild()` provides a temporary output directory and a cleanup helper.

## Table of Contents

[[toc]]

## Programmatic builds

Use the named `DomStack` export for a one-shot build with an explicit source directory, destination directory, and optional build options.
With your site in `./src` and additional files to copy in `./static`, save this as `build.mjs` and run `node build.mjs` from your project directory:

```js
/** @import { DomStackOpts } from '@domstack/static/types.js' */
import { DomStack } from '@domstack/static'

/** @type {DomStackOpts} */
const options = {
  copy: ['./static'],
}

try {
  const site = new DomStack('./src', './public', options)
  const results = await site.build()

  for (const warning of results.warnings) {
    console.warn(warning)
  }

  console.log('Built site in ./public')
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
```

`new DomStack(src, dest, opts)` accepts filesystem path strings, with relative paths resolved from the current working directory, including `opts.copy` paths.
`build()` creates the destination as needed, writes the site output, and resolves with a `Results` object containing discovery data, build-step results, and warnings.
Build failures reject the promise, so the example reports the error and sets a nonzero exit code.
The `DomStackOpts` and `Results` types are available from the type-only `@domstack/static/types.js` entry.

## Test builds

Use the top-level `testBuild` helper to build into a temporary directory from tests without managing setup and cleanup yourself.

```js
import { test } from 'node:test'
import assert from 'node:assert'
import { testBuild } from '@domstack/static'

test('site output', async () => {
  const build = await testBuild('./src')

  try {
    const html = await build.readOutput('index.html')
    assert.match(html, /Hello/)
  } finally {
    await build.cleanup()
  }
})
```

`testBuild(src, opts)` creates a temporary destination directory, runs `new DomStack(src, dest, opts).build()`, and returns `{ dest, results, readOutput, cleanup }`.
Options are passed through to `DomStack`, including `copy` paths.

See these repository tests for complete usage:

- [`test-build-helper/index.test.js`](https://github.com/bcomnes/domstack/blob/master/test-cases/test-build-helper/index.test.js) tests temporary output, `readOutput()`, copied directories, and cleanup.
- [`default-layout/index.test.js`](https://github.com/bcomnes/domstack/blob/master/test-cases/default-layout/index.test.js) uses `testBuild()` for a focused output assertion.
- [`generated-pages/index.test.js`](https://github.com/bcomnes/domstack/blob/master/test-cases/generated-pages/index.test.js) uses it with generated pages, global data, and templates.
