---
layout: post
title: "Thoughts on the Web Platform"
publishDate: "2025-02-14T14:00:00.000Z"
description: "Web components, view transitions, and why the platform keeps getting better."
tags:
  - web
  - platform
---

# Thoughts on the Web Platform

The web platform has been quietly getting very good.

## View Transitions

The View Transitions API lets you animate between page states with a few lines of CSS.
Works for both same-document and cross-document navigation. No JavaScript framework required.

## Custom Elements

Web Components via Custom Elements (`customElements.define`) are now well-supported
everywhere. They're not a replacement for component frameworks, but they're great for
leaf-node UI that needs to work anywhere.

## CSS

Container queries. `:has()`. Cascade layers. Logical properties. The CSS working group
has shipped more useful features in the last three years than in the decade before.

## The takeaway

Build with the platform where you can. Reach for frameworks and build tools when the
platform isn't enough. domstack tries to stay close to the platform — your JS is
bundled with esbuild, your HTML is just HTML, your CSS is just CSS.
