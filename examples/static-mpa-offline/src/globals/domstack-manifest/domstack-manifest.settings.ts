import type { DomstackManifestOptions } from '@domstack/static/types.ts'
import type {
  StaticMpaOfflineManifestVars,
  StaticMpaOfflinePageVars,
  StaticMpaOfflinePolicy,
} from '#service-worker-settings'
import { offlineFallbackUrl } from '#service-worker-settings'
import { emitServiceWorkerPolicy } from './policy-build.ts'

const settings = {
  manifestVars: ['offline', 'precache'],
  policy: {
    offlineFallbackUrl,
  },
  hooks: {
    manifestBuilt: [emitServiceWorkerPolicy],
  },
  includeEntry: entry => entry.kind !== 'metadata' && entry.kind !== 'sourcemap',
} satisfies DomstackManifestOptions<StaticMpaOfflinePolicy, StaticMpaOfflineManifestVars, StaticMpaOfflinePageVars>

export default settings
