import type { DomstackManifestOptions } from '@domstack/static/types.js'
import type {
  StaticMpaWorkboxManifestVars,
  StaticMpaWorkboxPageVars,
  StaticMpaWorkboxPolicy,
} from '#service-worker-settings'
import { offlineFallbackUrl } from '#service-worker-settings'
import { emitWorkboxManifest } from './policy-build.ts'

const settings = {
  // Expose only the resolved page vars that the service worker uses for route policy.
  manifestVars: ['offline', 'precache'],
  // Root policy is shared once instead of repeated on every manifest entry.
  policy: {
    offlineFallbackUrl,
  },
  // Convert the finalized Domstack manifest into Workbox policy before bundling the worker.
  hooks: {
    manifestBuilt: [emitWorkboxManifest],
  },
  // Internal metadata and source maps are not browser cache candidates.
  includeEntry: entry => entry.kind !== 'metadata' && entry.kind !== 'sourcemap',
} satisfies DomstackManifestOptions<StaticMpaWorkboxPolicy, StaticMpaWorkboxManifestVars, StaticMpaWorkboxPageVars>

export default settings
