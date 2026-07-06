import type { DomstackManifestEntry } from '@domstack/static/types.ts'

export const cachePrefix = 'domstack-static-mpa'
export const maxPrecacheBytes = 2 * 1024 * 1024
export const offlineFallbackUrl = '/offline/'
export const offlineRecheckIntervalMs = 5000
export const offlineStorageKey = `${cachePrefix}-offline`
export const onlineCheckTimeoutMs = 3000
export const precacheName = `${cachePrefix}-precache`
export const revisionParam = '__DOMSTACK_REVISION__'
export const runtimeCacheName = `${cachePrefix}-runtime`
export const serviceWorkerNotificationTag = 'domstack-static-mpa-offline'
export const serviceWorkerPolicyDefineName = '__DOMSTACK_SERVICE_WORKER_POLICY__'

export const cachePrefixes = [precacheName, runtimeCacheName] as const

export type StaticMpaOfflineRuntimeStrategy = 'network-only' | 'runtime'

export type StaticMpaOfflineManifestVars = {
  offline?: boolean
  precache?: boolean
}

export type StaticMpaOfflinePageVars = StaticMpaOfflineManifestVars & {
  layout?: 'root' | 'admin' | 'progressive-cache'
  title?: string
}

export type StaticMpaOfflinePolicy = {
  offlineFallbackUrl: string
}

export type ServiceWorkerConfig = {
  cachePrefixes: string[]
  precacheName: string
  runtimeCacheName: string
}

export type ActiveServiceWorkerConfig = ServiceWorkerConfig & {
  policy: StaticMpaOfflineServiceWorkerPolicy
}

export type StaticMpaOfflineServiceWorkerPolicy = {
  version: string
  entries: StaticMpaOfflineServiceWorkerPolicyEntry[]
  offlineFallbackUrl: string
}

export type StaticMpaOfflineServiceWorkerPolicyEntry = DomstackManifestEntry<StaticMpaOfflineManifestVars>

export type StaticMpaOfflinePrecacheEntry = StaticMpaOfflineServiceWorkerPolicyEntry & {
  revision: string
}
