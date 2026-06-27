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
