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
Before writing output, each full build empties the destination, including hidden files and stale outputs, while preserving the directory itself and its permissions.
Pass `{ clean: false }` to `new DomStack(src, dest, opts)` to skip destination cleanup.
The destination is owned by the build; keep persistent inputs in `src` or configured copy paths.
Cleanup rejects destinations containing the source, working directory, or copy inputs, resolving symlinks before checking.
If a build fails after cleanup, previous output is not restored and the destination may contain partial output.
Build failures reject the promise, so the example reports the error and sets a nonzero exit code.
If you're running more than one DOMStack build or watcher at a time, use separate output folders that aren't inside one another.
If another DOMStack build or watcher is already using an overlapping folder, `build()` rejects with the error code `DOMSTACK_DESTINATION_IN_USE` rather than asking the watcher to rebuild.
This check only coordinates DOMStack processes run by the same user on the same machine.
The `DomStackOpts` and `Results` types are available from the type-only `@domstack/static/types.js` entry.

## Watch sessions

Use `site.watch()` when your script or test needs a running preview that rebuilds as you edit.
`watch()` returns the first build report, but the watcher keeps running until you stop it.

```js
import { DomStack } from '@domstack/static'

const site = new DomStack('./src', './public')
await site.watch({ port: 8080 })

try {
  console.log(`Preview: ${site.watchInfo?.url}`)
  // Run your browser tests or other work here.
} finally {
  await site.stopWatching()
}
```

If `8080` is busy, DOMStack picks a free port, so use `watchInfo.url` to get the actual address.
For automatic rebuilds without a server, use `site.watch({ serve: false })`; the URL will be `null`.

Read `site.watchInfo` for the current session's state, ID, and preview URLs, or `null` when nothing is running.
The ID can be `null` while the watcher is still starting.
`await site.stopWatching()` waits for the watcher to finish writing so you can safely reuse the output folder.
The `WatchInfo` and `WatchOptions` types are exported from `@domstack/static/types.js`.

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

- [`test-build.test.js`](https://github.com/bcomnes/domstack/blob/master/test-build.test.js) tests temporary output, `readOutput()`, copied directories, and cleanup.
- [`default-layout/index.test.js`](https://github.com/bcomnes/domstack/blob/master/test-cases/default-layout/index.test.js) uses `testBuild()` for a focused output assertion.
- [`generated-pages/index.test.js`](https://github.com/bcomnes/domstack/blob/master/test-cases/generated-pages/index.test.js) uses it with generated pages, global data, and templates.
