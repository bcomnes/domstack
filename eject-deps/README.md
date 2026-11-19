# Eject dependencies

This private npm workspace holds the dependency ranges for DOMStack's optional ejected integrations: React, Preact, their types, and the Tailwind esbuild plugin.
Dependabot maintains these ranges through the root npm workspace configuration.

`npm run build:defaults` extracts the declared ranges into `lib/defaults/eject-deps.json`, rather than inspecting installed packages.
The generated JSON is checked in so a fresh checkout works without a build, and the test, build, and release flows regenerate it from this workspace.
Run `npm run build:defaults` after changing the ranges; do not edit the generated JSON directly.

`lib/cli/eject-features.js` reads the generated JSON so eject and `create-domstack-app` use the same metadata.
Only that data file ships in the DOMStack tarball; this workspace's `package.json` is not included, and the workspace is not published separately.

Dependencies used by the bundled defaults, including `fragtml`, `mine.css`, and `highlight.js`, remain sourced from DOMStack's root `package.json`.
