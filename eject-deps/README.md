# Eject dependencies

This private npm workspace holds the dependency ranges for DOMStack's optional ejected integrations: React, Preact, their types, and the Tailwind esbuild plugin.
Dependabot maintains these ranges through the root npm workspace configuration.

`lib/cli/eject-features.js` reads the declared ranges from this workspace's `package.json`, rather than hard-coding versions or inspecting installed packages.
The manifest is included in the published DOMStack package so eject and `create-domstack-app` can use the same metadata without installing this workspace as a runtime dependency.
The workspace itself is not published separately.

Dependencies used by the bundled defaults, including `fragtml`, `mine.css`, and `highlight.js`, remain sourced from DOMStack's root `package.json`.
