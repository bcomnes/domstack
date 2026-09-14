/**
 * @import { DomstackManifest, DomstackManifestOptions, DomstackManifestBuiltHookResult } from './schema.js'
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { assertInsideDest } from '../helpers/path.js'
import { DEFAULT_DOMSTACK_MANIFEST_FILENAME } from './schema.js'

/**
 * @param {string} dest
 * @param {DomstackManifest} domstackManifest
 */
export async function writeDomstackManifest (dest, domstackManifest) {
  const manifestPath = resolve(dest, DEFAULT_DOMSTACK_MANIFEST_FILENAME)
  assertInsideDest(dest, manifestPath)
  await mkdir(dirname(manifestPath), { recursive: true })
  await writeFile(manifestPath, JSON.stringify(domstackManifest, null, 2))
}

/**
 * @param {string} dest
 * @param {string} outputRelname
 * @param {string | Uint8Array} contents
 */
async function writeGeneratedManifestFile (dest, outputRelname, contents) {
  const filepath = resolve(dest, outputRelname.replaceAll('\\', '/'))
  assertInsideDest(dest, filepath)
  await mkdir(dirname(filepath), { recursive: true })
  await writeFile(filepath, contents)
}

/**
 * Run generated-artifact hooks after the domstack manifest has been built.
 *
 * @param {string} dest
 * @param {DomstackManifest} manifest
 * @param {DomstackManifestOptions} options
 * @param {{ claimOutput?: (outputRelname: string, hookIndex: number) => void, publicDest?: string }} [buildOptions]
 * @returns {Promise<DomstackManifestBuiltHookResult>}
 */
export async function runDomstackManifestBuiltHooks (dest, manifest, options, buildOptions = {}) {
  const serviceWorkerDefines = /** @type {Record<string, string>} */ ({})
  const hooks = options.hooks?.manifestBuilt ?? []

  for (const [hookIndex, hook] of hooks.entries()) {
    await hook({
      dest: buildOptions.publicDest ?? dest,
      manifest,
      defineServiceWorkerConstant: (identifier, value) => {
        const serializedValue = JSON.stringify(value)
        if (serializedValue === undefined) {
          throw new TypeError(`Service-worker define ${identifier} must be JSON-serializable`)
        }
        serviceWorkerDefines[identifier] = serializedValue
      },
      writeFile: (outputRelname, contents) => {
        buildOptions.claimOutput?.(outputRelname, hookIndex)
        return writeGeneratedManifestFile(dest, outputRelname, contents)
      },
    })
  }

  return { serviceWorkerDefines }
}
