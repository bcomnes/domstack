---
title: Building UI with Preact and htm
publishDate: "2024-03-22"
layout: blog
---

# Building UI with Preact and htm

DOMStack JavaScript pages can use any rendering library you like. This example uses [Preact](https://preactjs.com) with [htm](https://github.com/developit/htm) for JSX-like syntax without a build step.

## The Pattern

```js
import { html } from 'htm/preact'
import { render } from 'preact-render-to-string'

export default async function MyPage ({ vars, pages }) {
  return html`<div>
    <h1>${vars.title}</h1>
    <p>There are ${pages.length} pages on this site.</p>
  </div>`
}
```

The layout receives the return value as `children` and wraps it in the full HTML shell.

## Isomorphic Components

Because Preact renders to a string on the server, you can reuse the same component on the client by shipping a `client.js` bundle that hydrates the server-rendered markup.
