import { getActiveVersion } from './cache.js'
import { postToClients } from './clients.js'
import { logWorker, serviceWorker, warnWorker } from './context.js'
import {
  activatePendingCache,
  ensureOfflineFallbackIsPresent,
  prepareStaticCache,
} from './precache.js'

/**
 * @param {ExtendableMessageEvent} event
 */
export async function handleMessage (event) {
  const data = event.data
  if (!data || typeof data !== 'object') return
  logWorker('handling message', data)

  if (data.type === 'SKIP_WAITING') {
    logWorker('skip waiting requested by client')
    replyToMessage(event, { type: 'SKIP_WAITING_ACCEPTED' })
    await serviceWorker.skipWaiting()
    return
  }

  if (data.type === 'CHECK_FOR_UPDATES') {
    const message = await checkForManifestUpdate()
    replyToMessage(event, message)
    await postToClients(message)
    return
  }

  if (data.type === 'APPLY_PENDING_CACHE') {
    const version = await activatePendingCache()
    logWorker('pending cache applied by client request', { version })
    const message = { type: 'CACHE_UPDATE_APPLIED', version }
    replyToMessage(event, message)
    await postToClients(message)
  }
}

async function checkForManifestUpdate () {
  try {
    logWorker('checking domstack manifest for updates')
    const activeVersion = await getActiveVersion()
    const activeCacheIsReady = await ensureOfflineFallbackIsPresent()
    const result = await prepareStaticCache({ force: !activeCacheIsReady })
    logWorker('domstack manifest update check finished', {
      ...result,
      activeCacheIsReady,
      activeVersion,
    })

    if (result.status === 'ready' && !activeCacheIsReady) {
      const version = await activatePendingCache()
      logWorker('promoted first or repaired static cache during manifest check', { version })
      return {
        type: 'CACHE_UPDATE_CURRENT',
        version,
      }
    }

    return {
      type: result.status === 'ready' ? 'CACHE_UPDATE_READY' : 'CACHE_UPDATE_CURRENT',
      version: result.version,
    }
  } catch (err) {
    warnWorker('domstack manifest update check failed', err instanceof Error ? err.message : String(err))
    return {
      type: 'CACHE_UPDATE_FAILED',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * @param {ExtendableMessageEvent} event
 * @param {Record<string, unknown>} message
 */
function replyToMessage (event, message) {
  const port = event.ports?.[0]
  if (port) {
    logWorker('replying on message channel', message)
    port.postMessage(message)
    return
  }

  const source = event.source
  if (source && 'postMessage' in source && typeof source.postMessage === 'function') {
    logWorker('replying to message source', message)
    source.postMessage(message)
  }
}
