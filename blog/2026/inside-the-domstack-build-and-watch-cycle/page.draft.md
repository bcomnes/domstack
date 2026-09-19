---
layout: blog
title: "Inside the DOMStack build and watch cycle"
authors: ["bcomnes"]
description: "How DOMStack separates page building, global data, and watch state into smaller components with clear responsibilities and lifetimes."
publishDate: "2026-09-19T18:32:54.014Z"
---

A static-site build sounds straightforward: find some files, render them, and write the results.
Watch mode makes that description less useful.
Now the builder has to know what changed, which outputs depend on it, what it can reuse, and what to remember when a build fails halfway through.

DOMStack's global-data API made these questions especially visible.
A page edit can change a shared index, which can change a feed or a generated archive page without changing either of their source files.
Keeping all that bookkeeping alongside a simple public API made the implementation harder to follow than it needed to be.

The recent refactor separates the code around two questions: **who owns this state, and how long should it live?**
This is a tour of those boundaries, from an ordinary build through an incremental watch cycle.
The diagrams simplify scheduling to emphasize ownership and ordering; the [implementation reference](/docs/implementation/) covers the individual build phases in more detail.
On narrow screens, diagrams scroll horizontally rather than shrinking their text.

## Keep the public API small

`DomStack` is the public entry point.
It owns the source path, destination, and options, and exposes operations such as `build()`, `watch()`, `stopWatching()`, and `settled()`.
It should not also be the place where every dependency map and cleanup rule lives.

Watch orchestration belongs to `DomStackWatcher`.
It manages filesystem events, browser bundling, copy watchers, the development server, and the sequence of rebuild work.
Two smaller components own the bookkeeping: `WatchDependencyIndex` handles file dependencies, and `PageOutputLedger` handles output ownership.

<pre class="mermaid" tabindex="0" role="region" aria-label="Watch component ownership diagram">
flowchart TD
  accTitle: Public API and watch component ownership
  accDescr: DomStack owns its watcher. The watcher owns file dependency routing, output ownership, a watch session, and live resources. These are composed objects, not an inheritance hierarchy.
  API["DomStack"] --> WATCH["DomStackWatcher"]
  WATCH --> INDEX["WatchDependencyIndex"]
  WATCH --> LEDGER["PageOutputLedger"]
  WATCH --> SESSION["WatchSession record"]
  WATCH --> RESOURCES["Filesystem watchers, bundles and server"]
  INDEX --> ROUTING["Files to affected consumers"]
  LEDGER --> OWNERS["Sources to owned output paths"]
  SESSION --> RETAINED["Queued events and retained build state"]
</pre>

These are composed objects, not subclasses of one another.
The rule is not that every subsystem needs a class.
A class is useful when some state and the rules for maintaining it need a single owner.
Planning, discovery, layout resolution, and writing can still be functions.

## A page has three different representations

It helps to distinguish the description of a page from a live page being built and from the report of that build.

| Representation | What it means |
| --- | --- |
| `PageInfo` | Source identity, format, companion files, and output location |
| `PageData` | An initialized page with its renderer, layouts, vars, and subscriptions |
| `PageReport` | The source owner, selected layouts, and files actually emitted |

Discovery collects `PageInfo` records, layouts, templates, page factories, and settings into `SiteData`.
These are descriptions, not initialized rendering objects.
In particular, discovery finds page factories, but their generated pages do not exist yet.

An ordinary build prepares the destination and processes assets before starting the page phase.
Every page phase runs in a **fresh worker**, including watch rebuilds, so server-side modules can be loaded again without keeping the previous worker's module state.
Inside it, `buildPagesDirect()` coordinates the page work.

<pre class="mermaid" tabindex="0" role="region" aria-label="Page build pipeline diagram">
flowchart TD
  accTitle: Page building inside a fresh worker
  accDescr: Discovery records become initialized source pages. Global data runs before generated pages. Selected pages and templates write outputs and return reports and candidate state to the caller.
  INFO["SiteData and PageInfo records"] --> INIT["Initialize all source PageData objects"]
  INIT --> DATA["Run global-data producer"]
  DATA --> SELECT["Bind subscriptions and select output work"]
  SELECT --> FACTORIES["Run selected page factories"]
  FACTORIES --> GENERATED["Initialize and bind generated pages"]
  GENERATED --> PAGES["Render selected pages and layouts"]
  SELECT --> TEMPLATES["Render selected templates"]
  PAGES --> WRITE["Write outputs and record successful writes"]
  TEMPLATES --> WRITE
  WRITE --> REPORT["Return reports and candidate retained state"]
</pre>

Even a filtered build initializes **all source pages** before running global data.
The output filter decides what needs to be written, not which source pages the producer is allowed to know about.
Generated pages are downstream consumers of global data, rather than inputs to the same producer.

### Inside a page

`PageData` owns the page's prepared renderer, resolved layout chain, assets, warnings, and emitted-output records.
It delegates two stateful concerns:

- **`PageVars`** merges variable sources and maintains the first-access snapshot.
- **`PageSubscriptions`** maintains the page's and each layout's declared global-data views.

Vars flow from defaults and globals through outer layouts, inner layouts, companion vars, and finally builder vars such as Markdown frontmatter.
The cached, shallow-frozen merge is established on first vars access, not merely because initialization began.
That distinction lets initialization inspect an uncached merge without prematurely fixing the page's snapshot.

Rendering goes the other direction through the layouts: render the inner page, then wrap it from the innermost layout to the outermost.
The prepared renderer stays with that `PageData` for the build, but the object and renderer do not survive into the next worker.

Layouts are resolved records containing functions and metadata, rather than another family of runtime classes.
Generated definitions become ordinary `PageData` instances, so they do not need a separate rendering system either.

## Global data is not one big cache

There are three related things here, and treating them as one object obscures the watch model.

**Producer state** is the producer's retained working data.
For example, a blog producer might keep an index keyed by source identity so it can update changed entries rather than recompute everything.
It receives an isolated `previousState` and calls `setState(nextState)` to supply a cloneable snapshot for a future successful build.

**Published values** are what the producer returns for consumers to use during this build.
A retained per-source index might produce several published values: post summaries, archive groups, and feed entries.
The published result is not automatically the retained state.

**Subscriptions and fingerprints** describe which consumers use which published keys, and whether those keys changed since the previous successful build.
They are output-invalidation metadata, not the producer's index.

<pre class="mermaid" tabindex="0" role="region" aria-label="Global-data state boundaries diagram">
flowchart TD
  accTitle: Three distinct global-data concepts
  accDescr: A previous producer baseline and current source pages feed the producer. The producer separately returns published values and proposes retained state. Published values feed subscribed views and fingerprint-based output invalidation.
  PREVIOUS["Previous accepted producer baseline"] --> PRODUCER["Global-data producer"]
  PAGES["Initialized source pages and input changes"] --> PRODUCER
  PRODUCER -->|setState| CANDIDATE["Candidate next baseline"]
  PRODUCER -->|return| PUBLISHED["Published values"]
  PUBLISHED --> VIEWS["Page and layout subscription views"]
  PUBLISHED --> PRINTS["Current key fingerprints"]
  PRINTS --> COMPARE["Compare with previous successful subscriptions"]
  COMPARE --> OUTPUTS["Invalidate affected output consumers"]
  CANDIDATE --> ACCEPT["Retain only after build and cleanup succeed"]
</pre>

`PageSubscriptions` controls access to published values.
The page and each layout receive only their own declared keys.
A layout subscribing to a key does not grant the inner page access to it, although the combined dependencies determine whether the full page needs rebuilding.
The top-level views are guarded; nested values remain shared and are not intended to be mutated by consumers.

`WatchDependencyTracker` records those dependencies and compares fingerprints of enumerable top-level published keys.
Values that cannot be safely fingerprinted are treated conservatively as changed.
Non-enumerable keys intentionally sit outside that fingerprinting mechanism.

### Two different dependency questions

The similarly named dependency components answer different questions:

| Component | Question |
| --- | --- |
| `WatchDependencyIndex` | Which build inputs depend on this changed file? |
| `WatchDependencyTracker` | Which output consumers subscribe to a changed global-data key? |

Suppose a post's title changes.
The file index identifies the edited source page.
The producer updates its published post summaries, and the global-data tracker can then add the blog index or a subscribed feed template to the output work.
There does not need to be a JavaScript import from the feed to that Markdown file.

## Watching means planning, then accepting results

The watcher batches incoming events and serializes rebuild work.
A planner reads the discovery and dependency snapshot and chooses whether to skip, rebuild pages, restart browser bundling, or perform a full rebuild.
The planner itself does not write files or mutate the running site.

Events arriving during a build wait for another batch rather than starting an overlapping page phase.
When a page worker returns, the coordinator has a report of what happened and candidate state it might accept.

<pre class="mermaid" tabindex="0" role="region" aria-label="Watch build acceptance and recovery diagram">
flowchart TD
  accTitle: Watch planning, acceptance, and failure recovery
  accDescr: Events are batched and planned. For plans that produce page work, every reported write is recorded before success is checked. Successful builds reconcile stale outputs before accepting new state. Failed builds keep the previous baseline and require a full page retry.
  EVENTS["Queue source events"] --> PLAN["Filter and plan a batch"]
  PLAN --> WORK{"Page work needed?"}
  WORK -->|No| WAIT["Wait for next batch"]
  WORK -->|Yes| BUILD["Execute page build in a fresh worker"]
  BUILD --> RECORD["Record all reported writes"]
  RECORD --> OK{"Build succeeded?"}
  OK -->|No| FAIL["Keep accepted state and require full page retry"]
  OK -->|Yes| CLEAN["Reconcile ownership and remove stale outputs"]
  CLEAN --> CLEANOK{"Cleanup succeeded?"}
  CLEANOK -->|No| FAIL
  CLEANOK -->|Yes| ACCEPT["Refresh routing and accept candidate state"]
  ACCEPT --> WAIT
  FAIL --> WAIT
</pre>

The distinction between **recording writes** and **accepting a successful build** is deliberate.
Writes are not transactional: a page can emit a file and then fail while producing its next output.
We cannot pretend the first file never reached disk.

`PageOutputLedger` remembers writes as they happen in the returned reports, including partial results.
After success, it can replace ownership for rebuilt sources, preserve untouched owners and template claims, and remove stale page-owned paths.
If a page factory used to emit three archive pages and now emits two, that ownership tells us which third file may be deleted.

A failed build keeps the previous accepted producer baseline and subscription state, and the next page-producing plan retries the full page phase.
A cleanup failure also prevents advancing the producer baseline.
This is recovery bookkeeping, not rollback: the output directory may contain a mixture of old and new files until a successful rebuild completes.

## Cache the reusable work, not the whole application

A fresh worker does not mean every piece of preparatory work must be repeated.
The useful distinction is between reusable data and live rendering state.

The current watch implementation has a `MarkdownPreparationCache` for source text, parsed frontmatter, and title preparation.
It does **not** retain rendered HTML, layout functions, or Markdown renderer instances.
Each build still initializes pages against its current settings, vars, and global data.
Preparation updates are accepted only after successful work, and only when dependency routing is trustworthy enough to invalidate them later.

Other caches have similarly narrow jobs:

- `WatchDependencyIndex` can reuse successful import analysis when its dependencies are observed and have not been invalidated.
- `PageOutputLedger` retains additional-output hashes and filesystem metadata so unchanged writes can be skipped.
- `PageVars` avoids repeating a merge while its ordered source references remain the same.

These boundaries make an optimization easier to reason about: we can say what it saves, what invalidates it, and what it must never preserve.
They do not imply that every edit avoids all page work, or that we have a persistent cache of rendered pages.

## Lifetimes make the architecture easier to read

The system becomes much easier to follow when each object has an obvious stopping point.

| Lifetime | State |
| --- | --- |
| Public `DomStack` instance | Options, watch coordinator, and retained output ownership |
| Watch session | Live resources, queued events, producer baseline, and accepted source preparation |
| One page worker | Resolved layouts, current published global data, tracking and preparation-cache instances |
| One initialized page | Prepared renderer, vars snapshot, subscription views, and write records |
| Worker result | Plain reports and candidate data that the coordinator can accept |

Records such as `WatchSession`, `PageInfo`, and `PageReport` carry information without needing methods of their own.
Generated-page and additional-output helpers use async iterables so they can process results without first collecting every definition.
Worker error transport preserves structured details separately from the `Error` object, including subscription and output-conflict context.

The goal was not to make the build process look small by hiding it behind more classes.
It was to make each piece answer a narrower question: what changed, what can read this data, what owns this file, and when is this result safe to keep?

That leaves the public API simple without pretending that an incremental build is simple underneath.

## Read the code

The main entry points are:

- [Public facade](https://github.com/bcomnes/domstack/blob/e0364f6/index.js) and [watch coordinator](https://github.com/bcomnes/domstack/blob/e0364f6/lib/watch/index.js).
- [File dependency index](https://github.com/bcomnes/domstack/blob/e0364f6/lib/watch/dependency-index.js) and [output ledger](https://github.com/bcomnes/domstack/blob/e0364f6/lib/watch/page-output-ledger.js).
- [Page orchestration](https://github.com/bcomnes/domstack/blob/e0364f6/lib/build-pages/build.js) and [page state](https://github.com/bcomnes/domstack/blob/e0364f6/lib/build-pages/page/page-data.js).
- [Vars](https://github.com/bcomnes/domstack/tree/e0364f6/lib/build-pages/vars), [global data](https://github.com/bcomnes/domstack/tree/e0364f6/lib/build-pages/global-data), and [source preparation](https://github.com/bcomnes/domstack/tree/e0364f6/lib/build-pages/source-preparation).

These links pin the implementation described here to DOMStack 12.0.0-beta.10.
