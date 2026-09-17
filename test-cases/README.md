# Example-site acceptance tests

Each case is a checked-in DOMStack site paired with a test that builds it through the public API and checks the resulting files, HTML, reports, or expected build errors.
The source tree should be understandable as a site without reading JavaScript strings inside its test.
Most cases keep their site in `src/`; `nested-dest/` deliberately uses the case directory itself to exercise a destination nested inside the source.

## What belongs here

- Representative examples of pages, layouts, assets, templates, generated pages, and page outputs.
- Small invalid sites demonstrating conflicting pages, build failures, or unsafe output paths.
- Assertions on the example build and its observable outputs.
- Tests of example-specific producer logic, such as the generated-pages example's redirect validation.

## What belongs elsewhere

Detailed behavioral and regression tests live beside the subsystem they exercise under `lib/`, even when they build temporary sites or run real watchers.
Watch scheduling, lifecycle, cache invalidation, ownership, and recovery belong under `lib/watch/`.
CLI behavior belongs under `lib/cli/`, and page preparation, generation, output streaming, and worker transport belong under `lib/build-pages/`.
Public facade tests live at the repository root; public TypeScript contracts live in `type-tests/`.

Behavioral tests may copy an example site into a temporary directory before modifying it.
They must not mutate the checked-in example or depend on another test's output directory.
Keep test-only fixtures and helpers out of the published package and declaration build.

Run all JavaScript and runtime TypeScript tests with `node --test` and check compile-time contracts with `npm run test:tsc`.
