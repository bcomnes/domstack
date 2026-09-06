---
handlebars: false
---

# Rendering integrations

[Home](../../) · [Documentation](../)

## Table of Contents

[[toc]]

## Advanced

These features customize DOMStack’s rendering pipeline or coordinate generated assets with browser runtimes.

### Custom layout renderers

DOMStack's bundled default layout uses [`fragtml`][fragtml] because the default template only needs safe string manipulation.
You can eject or replace that layout with any Node-compatible renderer that returns an HTML string.
The previous incumbent for this job was `htm/preact` with [`preact-render-to-string`](https://github.com/preactjs/preact-render-to-string).
That is still a good fit when your Node-side pages or layouts produce Preact VNodes, or when you want the same component model on the server and in browser bundles.
If you also want Preact or React in browser JSX/TSX bundles, configure that separately as described in [`.tsx`](../../docs/pages/#tsx).

```console
npm install htm preact preact-render-to-string
```

```js
/**
 * @import { LayoutFunction } from '@domstack/static/types.js'
 * @import { VNode } from 'preact'
 */
import { html } from 'htm/preact'
import { render } from 'preact-render-to-string'

/** @type {LayoutFunction<Record<string, any>, string | VNode, string>} */
export default function rootLayout ({ children, vars, scripts, styles }) {
  return `<!DOCTYPE html>
${render(html`<html lang=${vars.lang ?? 'en'}>
  <head>
    <title>${vars.title}</title>
    ${styles?.map(style => html`<link rel="stylesheet" href=${style} />`)}
    ${scripts?.map(script => html`<script type="module" src=${script}></script>`)}
  </head>
  <body>
    ${typeof children === 'string'
      ? html`<main dangerouslySetInnerHTML=${{ __html: children }} />`
      : html`<main>${children}</main>`}
  </body>
</html>`)}`
}
```

[`preact-render-to-string`](https://github.com/preactjs/preact-render-to-string) works, but it builds a virtual DOM tree just to serialize layout HTML.
For layouts that mostly combine strings and already-rendered page content, [`async-htm-to-string`](https://github.com/voxpelli/async-htm-to-string) keeps the familiar HTM tagged-template style while rendering directly to strings.
That can be a better-performing and more direct tool for server-only layout templates.
You can still use Preact for browser-side components and use `async-htm-to-string` for Node-side layout rendering.

```console
npm install async-htm-to-string
```

```js
/**
 * @import { LayoutFunction } from '@domstack/static/types.js'
 */
import { html, rawHtml } from 'async-htm-to-string'

/** @type {LayoutFunction<Record<string, any>, string, Promise<string>>} */
export default async function rootLayout ({ children, vars, scripts, styles }) {
  return await html`<!DOCTYPE html>
<html lang="${vars.lang ?? 'en'}">
  <head>
    <title>${vars.title}</title>
    ${styles?.map(style => html`<link rel="stylesheet" href="${style}" />`)}
    ${scripts?.map(script => html`<script type="module" src="${script}"></script>`)}
  </head>
  <body>
    <main>${rawHtml(children)}</main>
  </body>
</html>`
}
```

Key differences from `htm/preact` and DOMStack's `fragtml` default:

- **Attribute names are standard HTML.**
Use `class` and `for` rather than React aliases like `className` and `htmlFor`, which `async-htm-to-string` will output literally with no warning.
For attributes like `tabindex`, `tabIndex` is only a casing preference in HTML, but using standard lowercase keeps templates consistent.
- **Always `await` the `html` tag.**
The tag returns an object that resolves to a string asynchronously.
If you return it without `await` from a non-async function, or assign it where a string is expected, you will get `[object Object]` in the output with no error thrown.
Use `async function` and `await` the result.

> [!CAUTION]
> `rawHtml()` bypasses HTML escaping and is equivalent to setting `innerHTML` directly.
Only use it with trusted HTML that you generated or sanitized yourself, such as the output of `await page.renderInnerPage()` or a trusted Markdown renderer.
`children` passed to a layout can be any type returned by a page function and may contain unsanitized content; always verify its source before passing it to `rawHtml()`.

[htm]: https://github.com/developit/htm
[fragtml]: https://www.npmjs.com/package/fragtml
[fragtml-docs]: https://github.com/bcomnes/fragtml#readme
[preact]: https://preactjs.com/
[domstack-sync]: https://www.npmjs.com/package/@domstack/sync
[hb]: https://handlebarsjs.com
[esbuild]: http://esbuild.github.io
