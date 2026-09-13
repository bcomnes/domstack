import { readFileSync } from 'node:fs'
import { registerHooks, stripTypeScriptTypes } from 'node:module'
import { pathToFileURL } from 'node:url'

const defaultLayoutURL = new URL('./default.root.layout.ts', import.meta.url)

/**
 * Node will not automatically strip TypeScript inside node_modules.
 * Explicitly strip only our canonical layout, preserving its URL for imports
 * and diagnostics and leaving user modules to Node's normal loader.
 * @param {string} layoutPath
 */
export async function loadLayout (layoutPath) {
  if (pathToFileURL(layoutPath).href !== defaultLayoutURL.href) return import(layoutPath)

  const hooks = registerHooks({
    load (url, context, nextLoad) {
      if (url !== defaultLayoutURL.href) return nextLoad(url, context)
      return {
        format: 'module',
        source: stripTypeScriptTypes(readFileSync(defaultLayoutURL, 'utf8'), { sourceUrl: url }),
        shortCircuit: true,
      }
    },
  })
  try {
    return await import(defaultLayoutURL.href)
  } finally {
    hooks.deregister()
  }
}
