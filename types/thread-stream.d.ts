import type { WorkerOptions } from 'node:worker_threads'

/**
 * Temporary compatibility for thread-stream <=4.2.0, which still references
 * worker_threads.TransferListItem after @types/node 26 removed that alias.
 * Upstream fix: https://github.com/pinojs/thread-stream/pull/233
 *
 * Remove this file, its public entry-point references, and its package files
 * entry once the supported Pino dependency tree requires the upstream fix.
 */
declare namespace ThreadStreamCompat {
  type TransferListItem = NonNullable<WorkerOptions['transferList']>[number]
}

declare module 'worker_threads' {
  // An import alias keeps the duplicate-name diagnostic here, rather than in
  // Node's declarations. The packed tests check old and new Node declarations.
  // @ts-ignore Node <=25 already exports this equivalent alias.
  export import TransferListItem = ThreadStreamCompat.TransferListItem
}
