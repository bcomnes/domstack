---
title: Site-wide Data with global.data.js
publishDate: "2025-02-10"
layout: blog
---

# Site-wide Data with global.data.js

`global.data.js` is an optional file you can create at the root of your `src` directory. It receives the full list of pages and returns an object that is merged into `vars` for every page, layout, and template.

## A Common Use Case

Aggregating blog posts for an index page or RSS feed:

```js
// src/global.data.js
export default async function globalData ({ pages }) {
  const posts = pages
    .filter(p => p.vars?.layout === 'blog')
    .sort((a, b) => new Date(b.vars.publishDate) - new Date(a.vars.publishDate))

  return { recentPosts: posts.slice(0, 5) }
}
```

The `vars.recentPosts` array is then available in every page and layout — no per-page wiring needed.

## Why Not postVars?

The old `postVars` feature solved a similar problem but ran per-page and caused every page that used it to re-render whenever any page changed. `global.data.js` runs once per build, making incremental watch rebuilds much faster.
