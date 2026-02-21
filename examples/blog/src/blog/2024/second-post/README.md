---
layout: post
title: "Layouts All the Way Down"
publishDate: "2024-07-04T09:00:00.000Z"
description: "How domstack's nested layout system works and why it keeps things simple."
tags:
  - domstack
  - layouts
---

# Layouts All the Way Down

Domstack layouts are just functions. The `post` layout is a TypeScript function that
receives `children` (the rendered page content), wraps it in article markup, and
delegates to the `root` layout for the full HTML shell:

```ts
const postLayout: LayoutFunction<PostVars> = (args) => {
  const { children, ...rest } = args
  const wrappedChildren = render(html`
    <article class="h-entry">
      <header>...</header>
      <div class="e-content">${children}</div>
    </article>
  `)
  return rootLayout({ ...rest, children: wrappedChildren })
}
```

No magic inheritance, no template partials, no special syntax. Just function composition.

## Styles follow the same pattern

`post.layout.css` imports `root.layout.css` with a plain CSS `@import`. esbuild
bundles them together. Each layout advertises its own stylesheet and client script,
and domstack injects the right ones automatically based on which layout a page uses.

## The `vars` merge order

```
{ ...globalVars, ...globalDataVars, ...pageVars, ...builderVars }
```

`globalDataVars` sits between global and page vars, so `global.data.ts` output is
available everywhere but can be overridden per-page if needed.
