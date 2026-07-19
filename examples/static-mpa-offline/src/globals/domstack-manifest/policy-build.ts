import type {
  DomstackManifest,
  DomstackManifestBuiltHookContext,
} from '@domstack/static/types.ts'
import type {
  StaticMpaOfflineManifestVars,
  StaticMpaOfflinePolicy,
  StaticMpaOfflineServiceWorkerPolicy,
} from '#service-worker-settings'
import {
  offlineFallbackUrl,
  serviceWorkerPolicyDefineName,
} from '#service-worker-settings'

/** Inject the final manifest data consumed by `/service-worker.js`. */
export async function emitServiceWorkerPolicy (
  context: DomstackManifestBuiltHookContext<StaticMpaOfflinePolicy, StaticMpaOfflineManifestVars>
): Promise<void> {
  context.defineServiceWorkerConstant(
    serviceWorkerPolicyDefineName,
    toServiceWorkerPolicy(context.manifest)
  )
}

function toServiceWorkerPolicy (
  manifest: DomstackManifest<StaticMpaOfflinePolicy, StaticMpaOfflineManifestVars>
): StaticMpaOfflineServiceWorkerPolicy {
  return {
    version: manifest.version,
    entries: manifest.entries,
    offlineFallbackUrl: manifest.policy?.offlineFallbackUrl ?? offlineFallbackUrl,
  }
}
