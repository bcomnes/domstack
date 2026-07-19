export const DOMSTACK_MANIFEST_URL = process.env['DOMSTACK_MANIFEST_URL'] ?? ''
export const DOMSTACK_MANIFEST_ENABLED = process.env['DOMSTACK_MANIFEST_ENABLED'] ?? 'false'
export const DOMSTACK_MANIFEST_VERSION = process.env['DOMSTACK_MANIFEST_VERSION'] ?? ''
export const CACHE_PREFIX = 'domstack-precache-'

export async function loadManifest () {
  if (DOMSTACK_MANIFEST_ENABLED !== 'true') {
    throw new Error('Domstack manifest is not enabled')
  }
  const response = await fetch(DOMSTACK_MANIFEST_URL, { cache: 'no-store' })
  if (!response.ok) throw new Error('Unable to load domstack manifest')
  return response.json()
}
