export const cachePrefix = 'domstack-workbox-static-mpa'
export const maxPrecacheBytes = 2 * 1024 * 1024
export const offlineFallbackUrl = '/offline/'
export const offlineRecheckIntervalMs = 5000
export const offlineStorageKey = `${cachePrefix}-offline`
export const onlineCheckTimeoutMs = 3000
export const runtimeCacheMaxAgeSeconds = 30 * 24 * 60 * 60
export const runtimeCacheMaxEntries = 50
export const runtimeCacheName = `${cachePrefix}-runtime`
export const runtimeCacheableStatuses = [200] as const
export const workboxOfflineFallbackCacheName = 'workbox-offline-fallbacks'
export const workboxPolicyDefineName = '__DOMSTACK_WORKBOX_POLICY__'

export const cachePrefixes = [cachePrefix, workboxOfflineFallbackCacheName] as const

export type StaticMpaWorkboxManifestVars = {
  offline?: boolean
  precache?: boolean
}

export type StaticMpaWorkboxPageVars = StaticMpaWorkboxManifestVars & {
  layout?: 'root' | 'admin' | 'progressive-cache'
  title?: string
}

export type StaticMpaWorkboxPolicy = {
  offlineFallbackUrl: string
}

export type WorkboxPrecacheEntry = {
  integrity?: string
  revision: string | null
  url: string
}

export type StaticMpaWorkboxServiceWorkerPolicy = {
  networkOnlyUrls: string[]
  offlineFallbackUrl: string
  precacheManifest: WorkboxPrecacheEntry[]
  runtimeUrls: string[]
  version: string
}
