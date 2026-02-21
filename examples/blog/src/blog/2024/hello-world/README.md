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
and compose them with layouts written in JSX (via preact).

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

## This layout

This post uses the `post` layout (`src/layouts/post.layout.ts`), which wraps the root layout
and adds article chrome: an `h-entry` microformat wrapper, author card, publish date, and tag list.

More posts coming soon.
