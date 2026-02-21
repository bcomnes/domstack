---
layout: post
title: "A New Year, A New Post"
publishDate: "2025-01-10T08:30:00.000Z"
description: "Kicking off 2025 with some thoughts on building for the web."
tags:
  - web
  - meta
---

# A New Year, A New Post

It's 2025. The web is still here. Static sites are still a good idea.

## Why static?

- Fast. No server render time.
- Cheap. A CDN and an object store is enough.
- Durable. HTML files outlast frameworks.
- Understandable. The output is exactly what the browser sees.

The build step is the complexity budget. Spend it wisely, then ship files.

## What global.data.ts gives you

Before `global.data.ts`, aggregating data across pages (blog indexes, RSS feeds) required
a `postVars` escape hatch that ran after the main build pass. It was implicit and hard
to reason about.

`global.data.ts` makes it explicit: one function, runs once, receives the fully initialized
page array, returns an object that every page can read. The blog index on this site is
just `vars.blogPosts.map(...)`. No special setup.
