/**
 * @import { TestContext } from 'node:test'
 * @import { WatchSnapshot } from '../watch-plan.js'
 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { find } from '@11ty/dependency-tree-typescript'
import { classifyWatchEvent, planWatchBatch } from '../watch-plan.js'
import { findDependencies } from './find-dependencies.js'

/** @param {TestContext} t @param {Record<string, string>} files */
async function fixture (t, files) {
  const directory = await mkdtemp(join(tmpdir(), 'domstack-dependencies-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  for (const [name, source] of Object.entries(files)) {
    const filepath = join(directory, name)
    await mkdir(dirname(filepath), { recursive: true })
    await writeFile(filepath, source)
  }
  return directory
}

/** @param {string[]} paths */
function absolutePaths (paths) {
  assert.ok(paths.every(path => typeof path === 'string'))
  return paths.map(path => resolve(path)).sort()
}

test('follows mixed JS/TS imports and named, star, and namespace re-exports transitively', async t => {
  const directory = await fixture(t, {
    'root.js': 'import { value } from "./barrel.ts"; export default value;',
    'barrel.ts': 'export { value } from "./nested/named.mjs"; export * as namespace from "./namespace.mts";',
    'nested/named.mjs': 'export * from "../leaf.cts";',
    'namespace.mts': 'export { value } from "./leaf.cts";',
    'leaf.cts': 'import "./side-effect.js"; export const value: number = 1;',
    'side-effect.js': 'export const loaded = true;',
  })
  const root = join(directory, 'root.js')
  const expected = ['barrel.ts', 'nested/named.mjs', 'namespace.mts', 'leaf.cts', 'side-effect.js'].map(name => join(directory, name)).sort()
  assert.deepEqual(absolutePaths(await findDependencies(root)), expected)
  assert.deepEqual(absolutePaths(await findDependencies(relative(process.cwd(), root))), expected)
  assert.equal((await findDependencies(root)).length, expected.length, 'shared leaves are deduplicated')
})

test('handles cycles and self-re-exports without returning the root', async t => {
  const directory = await fixture(t, {
    'root.ts': 'export * from "./barrel.ts"; export * from "./root.ts";',
    'barrel.ts': 'export * from "./root.ts"; import "./leaf.js";',
    'leaf.js': 'import "./barrel.ts";',
  })
  assert.deepEqual(absolutePaths(await findDependencies(join(directory, 'root.ts'))), [join(directory, 'barrel.ts'), join(directory, 'leaf.js')])
})

test('uses parsed syntax, not import-like comments, strings, templates, or regular expressions', async t => {
  const directory = await fixture(t, {
    'root.ts': [
      '// export * from "./missing-comment.js";',
      '/* import "./missing-block.js"; */',
      'const text: string = \'export { x } from "./missing-string.js"\';',
      'const template = `export * from "./missing-template.js"`;',
      'const regex = /export .* from "missing-regex"/;',
      'export {',
      '  value as renamed // a multiline re-export',
      '} from "./le\\u0061f.js";',
      'export { text, template, regex };',
    ].join('\n'),
    'leaf.js': 'export const value = 1;',
  })
  assert.deepEqual(absolutePaths(await findDependencies(join(directory, 'root.ts'))), [join(directory, 'leaf.js')])
})

test('ignores missing declaration-level type-only imports and re-exports erased by Node', async t => {
  const directory = await fixture(t, {
    'root.ts': 'export * from "./barrel.ts";',
    'barrel.ts': '',
  })
  for (const source of [
    'import type { A } from "./missing.ts";',
    'import type Default from "./missing.ts";',
    'import type * as Types from "./missing.ts";',

    'export type { A } from "./missing.ts";',
    'export type * from "./missing.ts";',
    'export type * as Types from "./missing.ts";',

    'import type {} from "./missing.ts";',
    'export type {} from "./missing.ts";',
  ]) {
    assert.equal(stripTypeScriptTypes(source).trim(), '', source)
    await writeFile(join(directory, 'barrel.ts'), source)
    assert.deepEqual(await findDependencies(join(directory, 'barrel.ts')), [], source)
    assert.deepEqual(absolutePaths(await findDependencies(join(directory, 'root.ts'))), [join(directory, 'barrel.ts')], source)
  }
})

test('all-type specifier lists retain side effects and transitive runtime dependencies', async t => {
  for (const source of [
    'import { type A } from "./registration.ts";',
    'import { type A, type B as C } from "./registration.ts";',
    'export { type A } from "./registration.ts";',
    'export { type A, type B as C } from "./registration.ts";',
  ]) {
    await t.test(source, async t => {
      const directory = await fixture(t, {
        'root.ts': source,
        'stripped.mjs': stripTypeScriptTypes(source),
        'registration.ts': 'import "./side-effect.ts"; export interface A { name: string } export type B = number;',
        'side-effect.ts': 'import { writeFileSync } from "node:fs"; writeFileSync(new URL("./executed.txt", import.meta.url), "registered");',
      })
      const root = join(directory, 'root.ts')
      const marker = join(directory, 'executed.txt')
      const expected = ['registration.ts', 'side-effect.ts'].map(name => join(directory, name))
      assert.deepEqual(absolutePaths(await findDependencies(root)), expected)
      assert.deepEqual(absolutePaths(await findDependencies(join(directory, 'stripped.mjs'))), expected, 'matches Node type stripping')
      await assert.rejects(readFile(marker), { code: 'ENOENT' }, 'analysis must not execute the modules')
      await import(pathToFileURL(root).href)
      assert.equal(await readFile(marker, 'utf8'), 'registered', 'Node executes the transitive side effect')
      await rm(join(directory, 'side-effect.ts'))
      await assert.rejects(findDependencies(root), { code: 'ENOENT' }, 'missing transitive runtime edges still fail conservatively')
    })
  }
})

test('does not traverse declaration-level type-only imports/re-exports into runtime dependencies', async t => {
  const directory = await fixture(t, {
    'root.ts': 'import type { A } from "./types.ts"; export type { A } from "./types.ts";',
    'types.ts': 'import "./missing-library.js"; export interface A { name: string }',
  })
  assert.deepEqual(await findDependencies(join(directory, 'root.ts')), [])
})

test('mixed value/type imports and re-exports retain the source and its transitive runtime edges', async t => {
  const directory = await fixture(t, {
    'root.ts': '',
    'values.ts': 'import "./leaf.js"; export interface Shape { name: string } export const value = 1; export default value;',
    'leaf.js': 'export const loaded = true;',
  })
  for (const source of [
    'import { type Shape, value } from "./values.ts";',
    'import { value, type Shape } from "./values.ts";',
    'import value, { type Shape } from "./values.ts";',
    'export { type Shape, value } from "./values.ts";',
    'export { value, type Shape } from "./values.ts";',
  ]) {
    await writeFile(join(directory, 'root.ts'), source)
    assert.deepEqual(absolutePaths(await findDependencies(join(directory, 'root.ts'))), ['leaf.js', 'values.ts'].map(name => join(directory, name)), source)
  }
  await rm(join(directory, 'values.ts'))
  await assert.rejects(findDependencies(join(directory, 'root.ts')), { code: 'ENOENT' })
})

test('preserves side-effect imports and empty named imports/re-exports as runtime edges', async t => {
  const directory = await fixture(t, {
    'root.ts': '',
    'runtime.ts': 'import "./leaf.js"; export const value = 1;',
    'leaf.js': 'export const loaded = true;',
  })
  const sources = [
    'import "./runtime.ts";',
    'import {} from "./runtime.ts";',
    'export {} from "./runtime.ts";',
  ]
  for (const source of sources) {
    await writeFile(join(directory, 'root.ts'), source)
    assert.deepEqual(absolutePaths(await findDependencies(join(directory, 'root.ts'))), ['leaf.js', 'runtime.ts'].map(name => join(directory, name)), source)
  }
  await rm(join(directory, 'runtime.ts'))
  for (const source of sources) {
    await writeFile(join(directory, 'root.ts'), source)
    await assert.rejects(findDependencies(join(directory, 'root.ts')), { code: 'ENOENT' }, source)
  }
})

test('does not confuse value bindings named type with type-only specifiers', async t => {
  const directory = await fixture(t, {
    'root.ts': 'import { type as value } from "./values.ts"; export { type } from "./values.ts";',
    'values.ts': 'export const type = 1;',
  })
  assert.deepEqual(absolutePaths(await findDependencies(join(directory, 'root.ts'))), [join(directory, 'values.ts')])
})

test('preserves existing import path strings and bare-import exclusion semantics', async t => {
  const directory = await fixture(t, {
    'root.js': 'import "node:fs"; import "uninstalled-package"; import "#alias"; import "./leaf.js";',
    'barrel.js': 'export * from "uninstalled-package"; export { readFile } from "node:fs"; export * from "./leaf.js";',
    'leaf.js': 'export const value = 1;',
  })
  const expected = await find(join(directory, 'root.js'))
  assert.deepEqual(await findDependencies(join(directory, 'root.js')), expected)
  assert.deepEqual(await findDependencies(join(directory, 'barrel.js')), expected)
  assert.deepEqual(await find(join(directory, 'barrel.js')), [], 'the original analyzer is not patched globally')
})

test('returns JSON and other attributed leaves as path strings, without parsing them as modules', async t => {
  const directory = await fixture(t, {
    'root.js': 'import data from "./data.json" with { type: "json" }; export * from "./barrel.ts";',
    'barrel.ts': 'export { default as more } from "./more.json" with { type: "json" }; export { default as css } from "./style.css" with { type: "css" };',
    'data.json': '{ "value": 1, "text": "export * from missing" }',
    'more.json': '{ "value": 2 }',
    'style.css': 'body { color: red; }',
  })
  const dependencies = await findDependencies(join(directory, 'root.js'))
  assert.deepEqual(absolutePaths(dependencies), ['barrel.ts', 'data.json', 'more.json', 'style.css'].map(name => join(directory, name)))
  assert.deepEqual(await findDependencies(join(directory, 'data.json')), [])
})

test('rejects missing roots and unresolved direct, transitive, and attributed dependencies', async t => {
  const directory = await fixture(t, {
    'root.js': 'import "./barrel.ts";',
    'barrel.ts': '',
  })
  await assert.rejects(findDependencies(join(directory, 'missing.js')), { code: 'ENOENT' })
  await assert.rejects(findDependencies(join(directory, 'missing.json')), { code: 'ENOENT' })
  for (const source of [
    'import "./missing.js";',
    'import { type A } from "./missing.ts";',
    'import { type A, type B as C } from "./missing.ts";',
    'export { type A } from "./missing.ts";',
    'export { type A, type B as C } from "./missing.ts";',
    'export { value } from "./missing.js";',
    'export * from "./missing.js";',
    'export * as values from "./missing.js";',
    'import data from "./missing.json" with { type: "json" };',
    'export { default as data } from "./missing.json" with { type: "json" };',
  ]) {
    await writeFile(join(directory, 'barrel.ts'), source)
    await assert.rejects(findDependencies(join(directory, 'barrel.ts')), { code: 'ENOENT' }, source)
    await assert.rejects(findDependencies(join(directory, 'root.js')), { code: 'ENOENT' }, source)
  }
})

test('propagates parser errors and rejects directories rather than returning incomplete results', async t => {
  const directory = await fixture(t, {
    'root.js': 'export * from "./broken.ts";',
    'broken.ts': 'export const value: = ;',
    'directory.js': 'export { default as data } from "./folder" with { type: "json" };',
    'folder/leaf.js': '',
  })
  await assert.rejects(findDependencies(join(directory, 'root.js')), SyntaxError)
  await assert.rejects(findDependencies(directory), /expected a file/)
  await assert.rejects(findDependencies(join(directory, 'directory.js')), /expected a file/)
})

test('reanalyzes edited barrel edges and notices removed leaves on later calls', async t => {
  const directory = await fixture(t, {
    'root.js': 'export * from "./barrel.js";',
    'barrel.js': 'export * from "./first.js";',
    'first.js': 'export const value = 1;',
    'second.js': 'export const value = 2;',
  })
  const root = join(directory, 'root.js')
  assert.deepEqual(absolutePaths(await findDependencies(root)), ['barrel.js', 'first.js'].map(name => join(directory, name)))
  await writeFile(join(directory, 'barrel.js'), 'export * from "./second.js";')
  assert.deepEqual(absolutePaths(await findDependencies(root)), ['barrel.js', 'second.js'].map(name => join(directory, name)))
  await rm(join(directory, 'second.js'))
  await assert.rejects(findDependencies(root), { code: 'ENOENT' })
})

/** @param {string} directory */
function watchFixture (directory) {
  const filepath = join(directory, 'feed.template.js')
  const template = {
    templateFile: { root: directory, filepath, relname: basename(filepath), basename: basename(filepath), parentName: '.' },
    path: '',
    outputName: 'feed.xml',
  }
  const leaf = join(directory, 'leaf.js')
  /** @type {WatchSnapshot} */
  const state = {
    siteData: { pages: [], templates: [template], pagesFiles: [], layouts: {} },
    layoutDepMap: new Map(),
    layoutPageMap: new Map(),
    pageFileMap: new Map(),
    layoutFileMap: new Map(),
    pageDepMap: new Map(),
    templateDepMap: new Map([[leaf, new Set([template])]]),
    pagesFileDepMap: new Map(),
    pagesFileLayoutMap: new Map(),
    globalDataDepPaths: new Set(),
    globalVarsDepPaths: new Set(),
    markdownDepPaths: new Set(),
    dependencyAnalysisFailed: false,
    pageBuildFailed: false,
    esbuildEntryPoints: new Set([leaf]),
  }
  return { state, leaf, template }
}

test('a barrel leaf shared with a template and browser role still invalidates each producer index', async t => {
  const directory = await fixture(t, {
    'producer.js': 'import { value } from "./barrel.ts"; export default value;',
    'barrel.ts': 'export * from "./named.js";',
    'named.js': 'export { value } from "./leaf.js";',
    'leaf.js': 'export const value = 1;',
  })
  const root = join(directory, 'producer.js')
  const original = new Set(absolutePaths(await find(root)))
  const complete = new Set(absolutePaths(await findDependencies(root)))
  const cases = /** @type {const} */ ([
    ['globalDataDepPaths', 'global-data-changed'],
    ['globalVarsDepPaths', 'global-vars-changed'],
    ['markdownDepPaths', 'markdown-settings-changed'],
  ])
  for (const [role, reason] of cases) {
    const { state, leaf, template } = watchFixture(directory)
    const event = classifyWatchEvent('change', leaf)
    state[role] = original
    const stale = planWatchBatch(state, [event])
    assert.equal(stale.inputChanges.resetReason, undefined, 'another known role masks the missing producer edge')
    state[role] = complete
    const batch = planWatchBatch(state, [event])
    assert.equal(batch.inputChanges.resetReason, reason)
    if (role === 'globalVarsDepPaths') {
      assert.equal(batch.plan.kind, 'full')
    } else {
      assert.equal(batch.plan.kind, 'pages')
      if (batch.plan.kind !== 'pages') throw new Error('Expected a page plan')
      assert.deepEqual(batch.plan.templateFilterPaths, [template.templateFile.filepath])
    }
  }
})

test('analysis errors let the caller select conservative recovery even for a known shared role', async t => {
  const directory = await fixture(t, { 'producer.js': 'export * from "./missing.js";' })
  const { state, leaf } = watchFixture(directory)
  try {
    state.globalDataDepPaths = new Set(absolutePaths(await findDependencies(join(directory, 'producer.js'))))
  } catch {
    state.dependencyAnalysisFailed = true
  }
  const batch = planWatchBatch(state, [classifyWatchEvent('change', leaf)])
  assert.equal(batch.inputChanges.resetReason, 'dependency-analysis-failed')
  assert.equal(batch.plan.kind, 'pages')
  if (batch.plan.kind !== 'pages') throw new Error('Expected a page plan')
  assert.equal(batch.plan.pageFilterPaths, null)
  assert.equal(batch.plan.templateFilterPaths, null)
  assert.equal(batch.plan.pagesFileFilterPaths, null)
})
