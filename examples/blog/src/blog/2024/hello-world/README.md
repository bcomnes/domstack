---
layout: post
title: "Hello, World"
publishDate: "2024-03-15T12:00:00.000Z"
description: "The first post on this blog. An introduction to what this is all about."
redirectFrom:
  - /blog/hello-world/
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
const blogPosts = collectBlogPosts(pages)
const blogIndexes = collectBlogIndexes(blogPosts)

return { blogPosts, blogIndexes /* ...other site data */ }
```

Pages and build factories explicitly subscribe to the returned keys they need and read
them through `data`, so unrelated pages stay independent of collection changes.

The yearly `/blog/2024/` and `/blog/2025/` archives are generated separately by
`src/blog-indexes.pages.ts`. `global.data.ts` groups the posts by year once, the pages file
turns those groups into normal pages, and the `year-index` layout renders each group's
newest-first posts. There are no hand-maintained year index files.

This page also owns its old `/blog/hello-world/` location through the `redirectFrom`
frontmatter above. `global.data.ts` collects that metadata, and `redirects.pages.ts`
generates the redirect to this page's current URL.

## This layout

This post uses the `post` layout (`src/layouts/post.layout.ts`), which wraps the root layout
and adds article chrome: an `h-entry` microformat wrapper, author card, publish date, and tag list.

More posts coming soon.
