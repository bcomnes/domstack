---
title: Progressive cache override
layout: progressive-cache
---

# Progressive cache override

This page uses the progressive-cache layout in frontmatter, but its sibling `page.vars.ts` overrides the layout policy:

```ts
export default {
  precache: true,
}
```

So unlike the other progressive-cache pages, this page should be available offline immediately after the service worker install finishes.
