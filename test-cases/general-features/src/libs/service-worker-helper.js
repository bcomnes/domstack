export const DOMSTACK_MANIFEST_URL = '/domstack-output-manifest.json'
export const CACHE_PREFIX = 'domstack-precache-'

export async function loadManifest () {
  const response = await fetch(DOMSTACK_MANIFEST_URL, { cache: 'no-store' })
  if (!response.ok) throw new Error('Unable to load domstack output manifest')
  return response.json()
}
