---
title: Docs
---

# Docs

This route is intentionally included in the PWA cache. It represents static documentation, legal pages, help pages, or other public content that should remain available after the first online visit.

The service worker gets this page from the generated domstack manifest instead of a handwritten list.

## Cache Inputs

- Page HTML, including `/docs/`
- Global CSS and JavaScript bundles
- Shared chunks
- Static icons and the web app manifest

## Cache Exclusions

- `/api/**` requests
- `/admin/**` routes
- `/blog/**` routes
- Source maps and Domstack metadata
