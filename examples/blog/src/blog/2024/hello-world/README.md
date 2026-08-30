---
layout: post
title: "Hello, World"
publishDate: "2024-03-15T12:00:00.000Z"
description: "The first post on this blog. An introduction to what this is all about."
tags:
  - meta
  - intro
---

# Hello, World

Welcome to this blog. It's built with [domstack](https://github.com/bcomnes/domstack),
a static site generator that lets you write pages in TypeScript, Markdown, or plain HTML
and compose them with typed HTML layouts written with fragtml.

## What makes this interesting

The post list you saw on the home page and the `/blog/` index weren't manually maintained.
They're generated at build time by `global.data.ts`:

```ts
// src/global.data.ts
const blogPosts = pages
  .filter(p => p.vars?.layout === 'post' && p.vars?.publishDate)
  .sort((a, b) => new Date(b.publishDate) - new Date(a.publishDate))
```

The returned object is stamped onto every page's `vars`, so any page or layout can read
`vars.blogPosts` directly — no postVars, no custom wiring.

The yearly `/blog/2024/` and `/blog/2025/` archives are generated separately by
`src/blog-indexes.pages.ts`. It creates one normal page per publication year, and the
`year-index` layout finds that folder's posts and renders them newest-first. There are no
hand-maintained year index files.

## This layout

This post uses the `post` layout (`src/layouts/post.layout.ts`), which wraps the root layout
and adds article chrome: an `h-entry` microformat wrapper, author card, publish date, and tag list.

More posts coming soon.
