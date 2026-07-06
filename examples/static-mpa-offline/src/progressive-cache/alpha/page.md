---
title: Progressive cache alpha
layout: progressive-cache
---

# Progressive cache alpha

This page uses Markdown frontmatter to select `layout: progressive-cache`.

That layout policy means:

- `offline: true`
- `precache: false`

So this route should not be cached during service-worker install. Visit it online once, then reload it offline.
