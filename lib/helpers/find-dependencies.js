import { stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { extname, resolve } from 'node:path'

// Resolve the analyzer's own runtime dependencies, even when they are not hoisted.
// Its TS wrapper does not expose the ESM finder's parserOverride option.
const require = createRequire(import.meta.resolve('@11ty/dependency-tree-typescript'))
/** @type {{ find: (filepath: string, options: { parserOverride: typeof parserOverride }) => Promise<string[]> }} */
const { find } = require(require.resolve('@11ty/dependency-tree-esm'))
const { Parser } = require('acorn')
const { tsPlugin } = require('@sveltejs/acorn-typescript')
const parser = Parser.extend(tsPlugin())

const parserOverride = {
  /** @param {string} contents */
  parse (contents) {
    const ast = parser.parse(contents, { sourceType: 'module', ecmaVersion: 'latest' })
    return {
      ...ast,
      body: ast.body.filter(node => {
        // Node erases declaration-level types only. Inline type specifiers leave
        // an import/export (possibly empty) that still executes the source module.
        if (node.type === 'ImportDeclaration') {
          return !('importKind' in node && node.importKind === 'type')
        }
        if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') {
          return !('exportKind' in node && node.exportKind === 'type')
        }
        return true
      }).map(node => {
        if ((node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source) {
          // Only the dependency walk sees this projection. Keep source and import
          // attributes intact so re-exported JSON/CSS remain attributed leaves.
          return { ...node, type: 'ImportDeclaration' }
        }
        return node
      }),
    }
  },
}

/** @param {string} filepath */
async function assertFile (filepath) {
  if (!(await stat(filepath)).isFile()) {
    throw new Error(`Cannot analyze dependency "${filepath}": expected a file`)
  }
}

/**
 * Find transitive static ESM imports and re-exports in JS/TS, using the existing
 * analyzer's cwd-relative path strings and bare-specifier exclusion semantics.
 * Declaration-level type-only imports/exports are excluded; inline type-only
 * specifier lists retain runtime edges. JSON roots have no dependencies;
 * attributed imports/re-exports remain leaves.
 * Missing files and parse errors reject so callers can invalidate conservatively
 * instead of installing an incomplete dependency index. No results are cached.
 *
 * @param {string} filepath
 * @returns {Promise<string[]>}
 */
export async function findDependencies (filepath) {
  const root = resolve(filepath)
  await assertFile(root)
  if (extname(root) === '.json') return []

  const dependencies = await find(root, { parserOverride })
  // The upstream finder silently accepts missing imports (including attributed
  // leaves). Validate every edge before returning anything to the caller.
  await Promise.all(dependencies.map(assertFile))
  return [...new Set(dependencies)].filter(dependency => resolve(dependency) !== root)
}
