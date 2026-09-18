/** @import HandlebarsType from 'handlebars' */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/**
 * Keep compilation synchronous while loading Handlebars only when enabled.
 * @param {string} source
 * @param {{ vars?: Record<string, unknown> }} context
 */
export function compileHandlebars (source, context) {
  if (!context?.vars?.['handlebars']) return undefined

  /** @type {typeof HandlebarsType} */
  const Handlebars = require('handlebars')
  return Handlebars.compile(source)
}
