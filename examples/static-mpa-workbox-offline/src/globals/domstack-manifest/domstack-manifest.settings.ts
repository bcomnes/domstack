import type { DomstackManifestOptions } from '@domstack/static/types.ts'
import type {
  StaticMpaWorkboxManifestVars,
  StaticMpaWorkboxPageVars,
  StaticMpaWorkboxPolicy,
} from '#service-worker-settings'
import { offlineFallbackUrl } from '#service-worker-settings'
import { emitWorkboxManifest } from './policy-build.ts'

const settings = {
  manifestVars: ['offline', 'precache'],
  policy: {
    offlineFallbackUrl,
  },
  hooks: {
    manifestBuilt: [emitWorkboxManifest],
  },
  includeEntry: entry => entry.kind !== 'metadata' && entry.kind !== 'sourcemap',
} satisfies DomstackManifestOptions<StaticMpaWorkboxPolicy, StaticMpaWorkboxManifestVars, StaticMpaWorkboxPageVars>

export default settings
