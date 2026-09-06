---
handlebars: false
---

# About DOMStack

[Home](../../) · [Documentation](../)

## Table of Contents

[[toc]]

## Design goals

DOMStack aims to make building a website feel like working directly with the web platform, with a small set of dependable conventions layered on top.

### Be simple and dependable

- Be boring, work well, and make the developer's job easier.
- Prefer convention over configuration.
  Configuration should be optional and minimal.
- Combine proven tools into one coherent system instead of reimplementing them.
- Avoid clever hacks, speculative abstractions, and complexity that becomes permanent maintenance work.
- Do not over-correct bad input.
  Clear inputs should produce predictable outputs.

### Build on the web platform

- HTML is the source of truth, and strings are the interchange format between rendering tools.
- Let browsers handle links, navigation, documents, and URLs.
  Do not add magic behavior to `<a>` or `<link>` elements or require client-side routing.
- Treat pages as shallow applications: each page starts as a new document and a blank canvas.
  Shared client state is possible, but not assumed.
- Remain library-agnostic.
  A page or layout is a program, so it can use tagged templates, a rendering library, or any other approach that returns the expected output.

### Make structure visible

- The source directory structure should mirror the site's URL structure.
- Every page should have an obvious entrypoint and build to an `index.html` in its corresponding directory, enabling clean URLs and reliable relative links.
- Keep pages and their assets colocated.
  Do not require parallel directory trees with matching structures.
- Support both `page.md` and `README.md` entrypoints.
  `README.md` keeps a source tree navigable on Git hosts, while `page.md` is available when repository navigation is not a concern.

### Keep build steps orthogonal

- Page rendering, static copying, and CSS and JavaScript bundling should remain independent build steps.
- Treat bundling as an optimization over a source tree that stays close to directly runnable web content.
- Keep entry filenames stable and conventional so each build input has an obvious purpose.
- Design independent steps so they can run concurrently when possible and rebuild only the outputs they affect.

### Use standard language tooling

- Use standard file types and syntax rather than framework-specific extensions or editor plugins.
- Use real TC39 ESM and prefer standard `.ts` and `.js` modules with `"type": "module"` over compatibility escape hatches.
- Support TypeScript through Node.js type stripping and JavaScript through JSDoc.
  Leave static type checking to `tsc`.
- Encourage directly runnable source modules.
  Language servers, formatters, linters, and debuggers should work without understanding a DOMStack-specific language.

### Prefer durable choices

- Build for the platform that exists now instead of simulating predicted future standards.
- Benefit from passive improvements to browsers, JavaScript, TypeScript, and Node.js by staying close to their conventions.
- Adopt ecosystem trends only when they solve a concrete problem better than the existing platform.

## FAQ

Why DOMStack?

:   DOMStack is named after the [DOM (Document Object Model)](https://developer.mozilla.org/en-US/docs/Web/API/Document_Object_Model) and the concept of stacking technologies together to build websites.
It represents the layering of HTML, CSS, and JavaScript in a cohesive build system and its emphasis of using what we have rather than inventing brand new ideas or concepts.
Also since I had to replace a Wallace and Gromit reference, it could  maybe also double as a [cheeky](https://youtu.be/tiJ4ffGZ7cM?t=77) homage to Node's former legend `substack`.

How does `domstack` relate to [`top-bun`](https://www.npmjs.com/package/top-bun)?

:   `top-bun` is the former name of `domstack` and was named after the bakery in Wallace & Gromit's [A Matter of Loaf and Death 🍞](https://www.youtube.com/watch?v=zXBmZLmfQZ4) which my kids were watching at the time.
The project and package were renamed to DOMStack and `@domstack/static` in v11.
See the [`top-bun` to DOMStack migration guide](../../docs/v11-migration.md) when updating an older project.
The `bun` project took off
and hosed the projects chances at SEO!

How does `domstack` relate to [`sitedown`](https://ghub.io/sitedown)

:   `top-bun` used to be called `siteup` which is sort of like "markup", which is related to "markdown", which inspired the project `sitedown` to which `domstack` is a spiritual off-shoot of.
Put a folder of web documents in your `domstack` build system, and generate a website.
`domstack` is definitely it's own thing now though!


Is this for real?

:   Yes!
The frontend space is crowded and brutal, and full of repeat ideas.
DOMStack started and will remain as an opensource-for-one project and my goal is to explore ideas that I haven't seen manifest in ways I would like to see elsewhere.
Usage and contribution is encouraged and welcome and appreciated of course.
I already consider the project a success for the goals I set out to achieve with it and don't plan to growth hack it at all.

## Project status

DOMStack is actively developed and currently available as a v12 prerelease.
Its core feature set includes:

- Markdown, HTML, and TypeScript pages
- Layouts with colocated styles and client bundles
- Global, layout, and page-scoped variables
- Centralized global data processing
- Generated pages and templates
- Static assets and additional copy directories
- Progressive watch rebuilds with dependency tracking
- TypeScript, JavaScript, and client-bundle TSX support
- Page-scoped Web Workers and a site service worker
- The DOMStack build manifest
- A built-in development server powered by [`@domstack/sync`][domstack-sync]

See the [GitHub roadmap](https://github.com/users/bcomnes/projects/3/) for planned work, or the [changelog](../../CHANGELOG.md) for completed changes.
Issues, ideas, and examples of sites built with DOMStack are welcome.

[htm]: https://github.com/developit/htm
[fragtml]: https://www.npmjs.com/package/fragtml
[fragtml-docs]: https://github.com/bcomnes/fragtml#readme
[preact]: https://preactjs.com/
[domstack-sync]: https://www.npmjs.com/package/@domstack/sync
[hb]: https://handlebarsjs.com
[esbuild]: http://esbuild.github.io
