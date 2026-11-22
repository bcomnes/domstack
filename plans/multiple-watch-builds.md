# Multiple watch builds — implementation plan

Issue: [bcomnes/domstack#352](https://github.com/bcomnes/domstack/issues/352)

## Progress

| Step | Repository | PR | Status |
| --- | --- | --- | --- |
| [1. Race-free port fallback](#pr-1--sync-race-free-port-fallback) | `domstack-sync` | [#42](https://github.com/bcomnes/domstack-sync/pull/42) | Open for review |
| [2. Local session discovery](#pr-2--sync-local-session-discovery) | `domstack-sync` | [#43](https://github.com/bcomnes/domstack-sync/pull/43) | Open for review; stacked on #42 |
| [3a. Copy lifecycle prerequisite](#pr-3a--cpx2-drain-copy-writes) | `cpx2` | [#199](https://github.com/bcomnes/cpx2/pull/199) | Open for review; release pending |
| [3. Destination ownership](#pr-3--domstack-destination-ownership) | `domstack` | — | In progress; depends on 3a |
| [4. Watch introspection](#pr-4--domstack-watch-introspection) | `domstack` | — | Not started |
| [5. Delegated rebuilds](#pr-5--domstack-delegated-rebuilds) | `domstack` | — | Not started |
| [6. Explicit watcher replacement](#pr-6--domstack-explicit-watcher-replacement) | `domstack` | — | Not started |

Update this table when work starts, a PR opens, or a PR merges.
Check off refactoring, implementation, and verification separately; record the test command or CI run and any unresolved gate in the relevant PR section.
Start each PR by running or adding focused coverage for the behavior being moved, then keep behavior-preserving refactors reviewable separately from feature changes within that PR.
Refactor only the code needed by the current PR; leave broader cleanup out of the stack unless it blocks a stated exit criterion.
Make focused checkpoint commits as each coherent change is validated, and check the Git status in each touched repository before pausing or handing off.
Leave the index and working tree clean at checkpoints, without staging unrelated user changes or temporary dependency links.
Use GitHub's `gh stack` extension to create and manage a native stack in each repository, not just a chain of PR base branches.
Use `gh stack init` or `gh stack add` locally and `gh stack submit` to publish; land the PRs bottom-up.
The Sync PRs are linked in native GitHub stack `#44`.
The released Sync version links the two stacks; a locally packed Sync build is fine for testing, but do not merge a temporary dependency reference.

### Review checkpoints

- [x] **After PRs 1–2:** Pause for review of Sync's port binding and public registry API before proceeding with the DOMStack work.
- [ ] **After PR 3:** Pause for review of destination ownership, crash recovery, and write-draining evidence before proceeding to PRs 4–6.
- After both reviews, work through PRs 4–6 in order without a scheduled pause; stop if a validation gate fails or implementation requires a design change.

## Agreed behavior and boundaries

- Multiple watchers can run without coordinating ports by hand, and humans and agents can list and inspect them across projects, including `watch --no-serve` sessions.
- Discovery is advisory and local to the current OS user and machine; it does not scan processes or the network, and cannot grant permission to write.
- DOMStack core guards output writes by canonical destination; identical and nested destinations conflict, while siblings do not.
- The ownership guarantee covers cooperating DOMStack processes sharing the same user, machine, and ownership namespace, not other users, isolated containers, or other machines sharing a filesystem.
- `lib/watch/` owns watch lifecycle, queued work, and watch-side control; the CLI owns handoff policy, user output, and process exit.
- Plain `domstack build` delegates by default to an exact canonical source/destination match, including embedded watchers; `--replace-watch` stops only that session and then cleans and builds locally under exclusive ownership.
- DOMStack Sync owns port binding and the shared discovery API, not destination claims, build queues, or takeover policy.
- Remote discovery, arbitrary session control, detailed diagnostic forwarding, force kills, automatic retries, and a separate daemon are out of scope.

## PR 1 — Sync: Race-free port fallback

Sync currently releases a probed port before binding the actual listener, so concurrent startups can race.
This PR changes binding only; it does not introduce discovery.

**Refactor first**

- [x] Trace where the main and UI startup paths consume ports before binding, then separate listener acquisition from publication of port-dependent URLs and snippets.
- [x] Consolidate the main and automatic UI bind/retry flow only where it is shared; keep resource setup and rollback attached to the listener that owns them, and leave throttle-port helpers alone.

**Implementation**

- [x] In `domstack-sync/lib/server.ts`, `lib/ui/server.ts`, and `lib/ports.ts`, try the preferred port on the real listener and retry with OS-assigned port `0` only on `EADDRINUSE`.
- [x] Apply the same policy to the automatic UI port, preferring the actual main port plus one when valid, and keep explicitly configured Sync UI ports strict.
- [x] Use the bound ports in instance fields, logs, the injected snippet, WebSocket URLs, and UI links; keep requests from seeing a placeholder or failed port and avoid repeating watcher or plugin side effects on retry.
- [x] Preserve startup rollback and `exit()` cleanup, and leave network-throttle port allocation and `reload --port` targeting unchanged.

**Exit criteria**

- [x] In `lib/server.test.ts`, hold a preferred port with a real listener and start multiple instances concurrently; verify each main/UI listener, injected snippet, and URL uses its own actual port.
- [x] Verify automatic UI fallback, explicit UI collision rollback, propagation of non-bind failures, and listener release on exit without using preselected free ports.
- [x] Document the fallback and actual-port reporting in the Sync README.

Validation: The concurrent-start regression reproduced `EADDRINUSE` against baseline `HEAD`; it passes with the real-listener retry.
The Sync Node and Chromium suites, type check, and lint passed.

## PR 2 — Sync: Local session discovery

The registry is usable without an HTTP listener, so DOMStack can register build-only watchers later.

**Refactor first**

- [x] Separate Sync CLI command dispatch from config loading and server startup so `sessions` shares help and argument handling without starting a server or importing project config.
- [x] Keep registry storage and lifecycle independent of Fastify; put standalone server registration and cleanup at the CLI boundary rather than changing library `createServer()` behavior.

**Implementation**

- [x] Export a typed API for registering, updating, disposing, listing, and looking up sessions by opaque ID.
- [x] Use a shared owner-only runtime directory with documented platform defaults and an override for tests.
- [x] Atomically write one versioned, allowlisted JSON record per random session ID, not per port or PID.
- [x] Include kind, PID, start time, lifecycle state, project/root paths, and bound local URLs and ports when available; exclude raw options, environment variables, snippets, and token-bearing socket URLs.
- [x] Remove records on orderly disposal; use PID checks and an expiring, refreshed lease for crash recovery, unref its timer, and make stale cleanup safe against concurrent live updates.
- [x] Register standalone Sync `start` sessions and call `exit()` on CLI shutdown; do not automatically register embedded `createServer()` calls.
- [x] Add `domstack-sync sessions [id] [--json]` across registered kinds without loading project config.

**Exit criteria**

- [x] Test same-PID and cross-process registration, lookup by ID, empty or malformed records, crash expiry, and credential-free JSON with an isolated registry directory.
- [x] Document discovery in the Sync README.
- [ ] After review and merge, release a Sync version containing PRs 1 and 2 for DOMStack to adopt in PR 4.

Validation: `node --test --test-timeout=15000` passed 173 tests; `npm run test:playwright` passed 31 Chromium tests; `npm run test:tsc` and `npm run test:lint` passed.
The subprocess discovery and signal tests ran on macOS; Windows access controls and signal behavior were not verified.

## PR 3a — cpx2: Drain copy writes

Land and release this upstream prerequisite before merging DOMStack PR 3.
DOMStack can prototype locking in parallel, but it must not rely on claim release until the copy drain guarantees are verified.

**Refactor first**

- [x] Read `cpx2/agents.md` and trace initial and steady-state copy/removal work in `lib/utils/watcher.js`, one-shot fan-out in `lib/utils/apply-action.js`, and stream completion and failure in `lib/utils/copy-file.js`.
- [x] Put tracking at the shared watcher copy/removal boundary so it covers startup scans and queued events without relying on emitted notifications.
- [x] Use a single all-settled strategy for parallel one-shot writes, and keep the established copy report and callback behavior.

**Implementation**

- [x] Add awaitable `closeAndDrain()` that immediately stops producers and cancels queued work, then waits for every copy or removal already in flight, including initial copies.
- [x] Preserve synchronous `close()` for callers that do not need to wait, and make repeated `closeAndDrain()` calls safe without losing track of work after `close()`.
- [x] Make `copy()` surface a failed file only after started sibling copies settle, including closing any output stream already opened when an error occurs.
- [x] Document the drain guarantees and cover the new watcher method in the public type declarations.

**Exit criteria**

- [x] Gate actual initial and steady-state copy I/O and a removal during shutdown; verify that `closeAndDrain()` stays pending, no new writes begin after close, and no writes remain after it resolves.
- [x] Fail one file in a one-shot batch while a sibling write is gated, and exercise a stream error with an open output; verify that rejection waits for writers and output handles to finish closing.
- [x] Run focused and full `cpx2` tests and type/lint checks, then test DOMStack with a temporary local build without committing the dependency reference.
- [x] Open the upstream PR: [bcomnes/cpx2#199](https://github.com/bcomnes/cpx2/pull/199).
- [ ] Record the released `cpx2` version here and update DOMStack's dependency and lockfile before merging PR 3.

Validation: `npm test` passed 114 `cpx2` tests on macOS, including the packed declaration consumer test.
After adding the startup-cleanup regression, all 16 focused tests, lint, and TypeScript passed.
Against a temporary local build, 27 DOMStack facade, lifecycle, and drain tests plus TypeScript passed; the original dependency installation was restored afterward.
The first GitHub matrix run exposed test-fixture races on Linux and invalid synthetic queue paths on Windows; `9c238af` seeds files before watcher startup and uses normalized queue keys.
The 16 focused tests, lint, and TypeScript passed locally after that correction; the new GitHub matrix result is pending.

## PR 3 — DOMStack: Destination ownership

This is the safety gate for delegation and cleanup.
At the end of this PR, a conflict fails clearly; it does not delegate, stop a watcher, or clean output.

**Progress notes**

- A macOS prototype using `fs-native-extensions` passed same-process exclusivity, ancestor conflict and sibling concurrency, paused-owner blocking, and release after `SIGKILL`; it used shared locks on ancestors and an exclusive lock on the destination.
- An isolated claim module now uses shared ancestor locks and an exclusive destination lock via `fs-native-extensions`, without adding a coordinator file or enabling claims at production entry points.
- Targeted macOS tests cover aliases, nested conflicts in both directions, siblings, a paused claimant, and release after a crash; Linux validation is still pending.
- DOMStack-owned build fan-outs now wait for settled writes before surfacing errors; focused tests, TypeScript, and targeted lint passed.
- The installed `cpx2` release still lacks the drain guarantees; the verified fix is in PR 3a, and DOMStack has not switched its watch teardown to the new API yet.

**Refactor first**

- [ ] Trace the public build, serve, and watch paths to their first output mutation; give one-shot builds and watch startup a single ownership boundary per writer so no path claims twice or starts work unguarded.
- [ ] Separate stopping producers from waiting for their writes to finish; give watch shutdown and failed one-shot builds an explicit drain point before adding claim release.
- [ ] Keep canonical-path matching and cross-process claims in DOMStack core; keep watch queue and resource cleanup in `lib/watch/` instead of introducing a second lifecycle coordinator.

**Implementation**

- [ ] Canonicalize source and destination consistently across processes, including relative paths, symlink aliases, and destinations not yet on disk.
- [ ] Validate OS-backed claims: acquire a shared lock at each ancestor and an exclusive lock at the destination, root first, and unwind partial claims on conflict; record a conservative alternative if platform or crash-recovery checks fail.
- [ ] Check conflicts by path component, acquire before any output mutation, and hold until all writes drain; expose the same guard to watch, one-shot builds, the build phase of `serve`, and library writers.
- [ ] Keep claims separate from discovery leases and socket responsiveness, and identify the owner when possible in conflict errors.
- [ ] Use `cpx2`'s `closeAndDrain()` in `lib/watch/index.js`, and await it before releasing claims on failure, startup cancellation, or normal shutdown.
- [x] Update DOMStack-owned write fan-outs to wait for sibling writes on failure.
- [ ] Verify the upstream one-shot `copy()` drain through DOMStack's static and extra-copy build paths, then replace any local link with the released `cpx2` dependency and lockfile update.

**Exit criteria**

- [ ] Verify identical and aliased paths conflict, nested paths conflict in both acquisition orders, and siblings or string-prefix lookalikes can run concurrently.
- [ ] Verify a paused writer still blocks claims, a crashed writer does not leave a permanent claim, and stale or missing discovery cannot bypass a live claim.
- [ ] Hold a real watched copy or removal open during shutdown and force a one-shot step to fail while a sibling is still writing; verify neither claim is released early.
- [ ] Validate the ownership mechanism on Linux and macOS; current CI is Ubuntu-only, so add a targeted macOS check.
- [ ] Document separate, non-overlapping output directories in the DOMStack CLI/API docs.

## PR 4 — DOMStack: Watch introspection

The current CLI forwards `--port` only to `serve`, and `watch()` returns the initial build report rather than live session details.
Add a separate snapshot without changing that return value or the initial build callback.

**Refactor first**

- [ ] Separate `sessions` dispatch from the project CLI path in `bin.js`, and make positional parsing and required project paths depend on the command in `lib/cli/args.js`.
- [ ] Make the existing watch session the single source of truth for lifecycle and bound addresses, and derive both the public snapshot and registry updates from it instead of maintaining parallel state.

**Implementation**

- [ ] Adopt the released `@domstack/sync` version and update the lockfile.
- [ ] Add `watch({ port })` and `domstack watch --port` through `lib/cli/options.js`, `lib/cli/args.js`, help, and `bin.js`; pass the preference to Sync only when serving.
- [ ] Expose a typed `watchInfo` snapshot in `index.js` and publish one `domstack-watch` record per session from `lib/watch/index.js`, with absolute source/destination paths, lifecycle state, and nullable bound URLs and ports.
- [ ] Update records on lifecycle transitions and dispose them on normal stop, cancellation, and startup failure; registry write failures warn without stopping a build or hiding in-process `watchInfo`.
- [ ] Add `domstack sessions [id] [--json]` before builder construction and source/destination validation; filter to DOMStack watch records and allow the optional positional ID only for `sessions`.
- [ ] Print actual bound URLs and a session ID at startup; make an empty list successful, missing IDs nonzero, and JSON output free of logs or decoration.

**Exit criteria**

- [ ] Extend `lib/watch/lifecycle-tests/` and `lib/cli/tests/commands.test.js`: run two temporary sites with separate destinations on the same preferred port, discover them from another directory, edit each, and stop one without affecting the other.
- [ ] Cover `--no-serve`, signal cleanup, startup cancellation or failure, registry failure, unchanged `watch()` returns and callback, stable JSON, and strict positional parsing for other commands.
- [ ] Document port fallback, `watchInfo`, and discovery in `docs/cli/README.md` and `docs/api/README.md`.

## PR 5 — DOMStack: Delegated rebuilds

Introduce `rebuild` only; callers still cannot stop watchers or clean destinations.

**Refactor first**

- [ ] Make the existing watch queue accept explicit jobs alongside filesystem work, with a per-request result and without allowing a rejected job to break later queue entries.
- [ ] Separate page-build outcomes from event-driven logging and recovery so the same executor can report truthful results to a delegated caller without duplicating build logic.
- [ ] Separate the CLI's build routing from the one-shot execution path, and keep socket transport and protocol handling out of the builder.

**Implementation**

- [ ] Put a private per-session control socket in `lib/watch/`, independent of Sync listeners: use an owner-only Unix socket directory on macOS and Linux, and a named pipe with verified same-user access controls if Windows is supported.
- [ ] Verify the expected session ID and keep control credentials out of discovery output; set a short connection timeout and fail clearly on unreachable owners rather than falling back to local writes.
- [ ] Route plain `domstack build` to an exact canonical source/destination match by default for both CLI and embedded watchers; reject nested conflicts and different sources for the same destination.
- [ ] Log `Rebuilding via active watch session … (watch mode)` and queue one full watch rebuild per request; reject new requests while starting or stopping and let the caller retry startup conflicts.
- [ ] Use the watcher's settings and artifacts, leave detailed logs with the watcher, and return a short success or failure result and corresponding CLI exit status without coalescing requests or merging settings.
- [ ] Reject explicitly supplied output-affecting flags rather than silently ignoring them; point callers to `--replace-watch` once that flag lands in PR 6.
- [ ] Return a real result without breaking recovery: `#runPageBuild()` currently logs page errors without propagating them, so awaiting `#fullRebuild()` alone is not enough.
- [ ] Reset incremental input state for explicit rebuilds; reconcile static copies before reporting success or document the first-release freshness limitation if they remain outside the queue.

**Exit criteria**

- [ ] Test subprocess delegation with `--no-serve` and with an embedded watcher without opt-in; verify requests serialize, no second writer starts, a failed page returns nonzero, and the watcher remains alive.
- [ ] Test an unobserved global-data edit, an asset-only edit, explicit output-affecting flags, and the watch-mode handoff message.
- [ ] Test startup/rebuilding/stopping responses, wrong session IDs, and unreachable owners; validate the local socket on macOS as well as Linux.
- [ ] Document delegation, watcher-owned output, and any asset freshness limitation in the CLI docs.

## PR 6 — DOMStack: Explicit watcher replacement

Add `stop` to the control protocol and make replacement opt-in through `domstack build --replace-watch`.

**Refactor first**

- [ ] Route CLI signals and accepted control stops through the existing shared watch shutdown; keep process exit a CLI decision and keep the control connection available long enough to return the shutdown result.
- [ ] Reuse the existing one-shot execution path for replacement by adding a guarded cleanup step under the same destination claim, not a separate build implementation.
- [ ] Delete temporary delegation guidance or transitional code only where PR 6 replaces it, and rerun the prior PRs' overlap and lifecycle regressions before merging.

**Implementation**

- [ ] Add the build-only flag in `lib/cli/options.js` and route it in `bin.js`; with no owner it behaves like an ordinary one-shot build.
- [ ] Require an exact canonical source/destination match, validate the cleanup target before requesting shutdown or deleting files, and reject roots, the source, and ancestors of the source.
- [ ] Log which session is being stopped and call its existing shutdown path; accept `stop` during startup once the socket is available, reject queued rebuilds, drain active writes, and share cleanup across repeated stop requests.
- [ ] Use a longer shutdown timeout than the connection timeout; finish accepted shutdown even if the caller disconnects or times out, but have a failed caller exit without cleaning or building.
- [ ] Stop only the matching session; the watch CLI exits after cleanup, but an embedded host and unrelated sessions stay alive.
- [ ] After a successful stop, acquire the destination claim, clean the output contents, and run the one-shot build in the invoking process; if another writer wins the claim, fail without cleaning, building, or stopping the new owner.

**Exit criteria**

- [ ] Test replacement with and without a watcher; verify draining and ownership transfer happen before cleanup or one-shot writes and that watch-only artifacts are gone after successful takeover.
- [ ] Verify the matching watch CLI exits while an embedded host and its other sessions stay alive.
- [ ] Test repeated stop, startup cancellation, stop during an active rebuild, caller disconnect and timeout, unsafe cleanup targets, different sources and nested conflicts, and a competing ownership claim.
- [ ] Document the flag and its destructive cleanup behavior, and update the delegation error to point to `--replace-watch`.
