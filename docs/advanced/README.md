---
layout: docs
docsOrder: 125
handlebars: false
---

# Advanced

These guides cover specialized composition, output control, incremental processing, and type contracts.
Start with the core [Pages](../pages/), [Layouts](../layouts/), and [Data](../data/) guides, then use these references when your site needs more control.

- [Composition pages](./composition-pages/) keep pages available for explicit rendering without automatically publishing their page-owned output.
- [Page outputs](./page-outputs/) publish page-owned downloads, JSON metadata, and other sidecar files through build-only hooks.
- [Incremental global data](./incremental-global-data/) retains indexes between watch rebuilds and updates only affected source entries.
- [Output manifest](./output-manifest/) describes emitted files for deployment tools, offline caching, and build-time integrations.
- [Layout registry and type contracts](./layout-registry/) provides precise rendering types, optional layout-chain inference, and supplied-variable validation.
