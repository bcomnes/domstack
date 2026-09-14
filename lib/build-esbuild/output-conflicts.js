/** @import { BuildOptions, Message } from 'esbuild' */
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { OutputRegistry } from '../output-registry.js'
import { toPosix } from '../helpers/path.js'

/** Entry output patterns, using esbuild's configured base, aliases and extensions.
 * @param {BuildOptions} opts
 */
function entryOutputs (opts) {
  const entries = Array.isArray(opts.entryPoints)
    ? opts.entryPoints.map(entry => typeof entry === 'string' ? { in: entry, out: undefined } : entry)
    : Object.entries(opts.entryPoints ?? {}).map(([out, input]) => ({ in: input, out }))
  const cwd = opts.absWorkingDir ?? process.cwd()
  const base = resolve(cwd, opts.outbase ?? '.')
  return entries.map(entry => {
    const extension = extname(entry.in)
    const outputExtension = extension === '.css' ? '.css' : '.js'
    const name = basename(entry.in, extension)
    const dir = toPosix(relative(base, dirname(resolve(cwd, entry.in))))
    const pattern = (entry.out ?? (opts.entryNames ?? '[dir]/[name]')
      .replaceAll('[dir]', dir || '.')
      .replaceAll('[name]', name)
      .replaceAll('[ext]', (opts.outExtension?.[outputExtension] ?? outputExtension).slice(1))) + (opts.outExtension?.[outputExtension] ?? outputExtension)
    return { pattern: toPosix(join(pattern)), source: entry.in }
  })
}

/** Reject statically identifiable entry collisions, including identical contents
 * that esbuild would silently coalesce. Hashed names are checked on native errors.
 * @param {BuildOptions} opts
 */
export function validateEsbuildEntryOutputs (opts) {
  if (opts.outfile || !opts.outbase) return
  const registry = new OutputRegistry()
  const seen = new Set()
  for (const { pattern, source } of entryOutputs(opts)) {
    if (pattern.includes('[hash]') || pattern.startsWith('../')) continue
    const key = JSON.stringify([pattern, source])
    if (seen.has(key)) continue
    seen.add(key)
    registry.claim(pattern, { id: source, type: 'esbuild', path: source })
  }
}

/** Attach domain conflict diagnostics when the native collision can be traced to
 * two configured entries. Unidentifiable plugin/chunk errors stay native rather
 * than inventing producer attribution or rerunning user plugins.
 * @param {Message[]} errors
 * @param {BuildOptions} opts
 */
export function rethrowEsbuildOutputConflict (errors, opts) {
  if (!opts.outdir || !opts.outbase) return
  for (const error of errors) {
    const match = /Two output files share the same path but have different contents: (.+)$/.exec(error.text)
    if (!match?.[1]) continue
    const path = toPosix(relative(resolve(opts.absWorkingDir ?? process.cwd(), opts.outdir), resolve(opts.absWorkingDir ?? process.cwd(), match[1])))
    const candidates = entryOutputs(opts).filter(({ pattern }) => {
      const patterns = [pattern]
      const jsExtension = opts.outExtension?.['.js'] ?? '.js'
      if (pattern.endsWith(jsExtension)) patterns.push(pattern.slice(0, -jsExtension.length) + (opts.outExtension?.['.css'] ?? '.css'))
      return patterns.some(pattern => {
        const regex = pattern.split('[hash]').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]+')
        return new RegExp(`^${regex}(?:\\.map)?$`).test(path)
      })
    })
    if (new Set(candidates.map(entry => entry.source)).size < 2) continue
    const registry = new OutputRegistry()
    for (const entry of candidates) registry.claim(path, { id: entry.source, type: 'esbuild', path: entry.source })
  }
}
