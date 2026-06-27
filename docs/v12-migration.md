# Migration Guide: domstack v12

This guide is a stub for breaking changes in the next major version of `@domstack/static`.

## Type exports moved to `@domstack/static/types.js`

In v12, runtime values remain available from `@domstack/static`, but public types have moved to a dedicated type-only entry.

```ts
// Before v12
import type { LayoutFunction, PageFunction, DomStackOpts } from '@domstack/static'

// v12+
import type { LayoutFunction, PageFunction, DomStackOpts } from '@domstack/static/types.js'
```

Why the `.js` extension? `@domstack/static` intentionally keeps open package subpath exports via `main` instead of an export map. For Node.js ESM package subpaths, consumers should include the `.js` extension even though the published artifact for this entry is declaration-only today.

The `types.ts` source file is type-only and emits `types.d.ts`. A runtime `types.js` companion may be added in the future if needed.
