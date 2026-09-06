---
layout: docs
handlebars: false
---

# Programmatic API

## Table of Contents

[[toc]]

### Programmatic test builds

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

[htm]: https://github.com/developit/htm
[fragtml]: https://www.npmjs.com/package/fragtml
[fragtml-docs]: https://github.com/bcomnes/fragtml#readme
[preact]: https://preactjs.com/
[domstack-sync]: https://www.npmjs.com/package/@domstack/sync
[hb]: https://handlebarsjs.com
[esbuild]: http://esbuild.github.io
