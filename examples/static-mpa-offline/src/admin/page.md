---
title: Admin / network-only page
---

# Admin / network-only page

This route demonstrates opting a section out of offline availability.

Its sibling `page.vars.ts` selects the `admin` layout:

```ts
export default {
  layout: 'admin',
}
```

`src/layouts/admin.layout.ts` exports these layout vars:

- `offline: false`
- `precache: false`

So `/admin/` should load while online, but an offline reload should show the offline fallback page instead of this page.

