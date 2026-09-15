# Contributing

## Guidelines

- Patches, ideas and changes welcome.
- Fixes almost always welcome.
- Features sometimes welcome.
  - Please open an issue to discuss the issue prior to spending lots of time on the problem.
  - It may be rejected.
  - If you don't want to wait around for the discussion to commence, and you really want to jump into the implementation work, be prepared to fork if the idea is respectfully declined.
- Try to stay within the style of the existing code.
- All tests must pass.
- Additional features or code paths must be tested.
- Aim for 100% coverage.
- Questions are welcome, however unless there is a official support contract established between the maintainers and the requester, support is not guaranteed.
- Contributors reserve the right to walk away from this project at any moment with or without notice.

## Generated default layout

Edit `lib/defaults/default.root.layout.ts`, then run `npm run build:defaults` to regenerate `lib/defaults/default.root.layout.js`.
The JavaScript is checked in so normal development and tests work immediately after checkout, without a declaration build or a runtime TypeScript loader.
Do not edit the generated JavaScript directly.
Both layouts are published, and eject copies the requested language (rewriting the TypeScript type import to the public package entry).
Declaration cleanup and `npm run clean` deliberately preserve the generated JavaScript.

## Releasing

Changelog, and releasing is automated with npm scripts and actions.  To create a release:

- Navigate to the actions tab
- Select the `npm bump` action.
- Trigger an action, specifying the semantic version bump that is needed.
- Changelog, Github release and npm publish is hanlded by the action.
- An in depth review of this system is documented here: [bret.io/projects/package-automation](https://bret.io/projects/package-automation/)

If for some reason that isn't working or a local release is preferred, follow these steps:

- Ensure a clean working git workspace.
- Run `npm version {patch,minor,major}`.
  - This updates the version number, builds the default JavaScript and version-dependent manifest schema, and uses `releasearoni version --add` to stage both generated files alongside the changelog before npm creates the version commit and tag.
- Run `npm publish`.
  - `releasearoni` runs the full build before pushing the branch and tags and creating the GitHub release.
  - The `prepack` hook cleans old declarations before regenerating the default JavaScript and declarations for both `npm pack` and `npm publish`, so tarballs include both layout languages and their types even after a full release build.
  - Post-publish cleanup removes temporary declarations and site output, but preserves versioned JavaScript so it does not dirty the version commit.

Generation belongs in `version`, not `preversion` (which runs before the version update) or `postversion` (which runs after the commit and tag).
The release workflow's pre-version reset/clean is safe because the initial generated JavaScript is tracked and the version hook rebuilds it before staging.
Run `npm run test:version-build` to verify generation, staging, tagging, and cleanup in a disposable repository without versioning this checkout.
