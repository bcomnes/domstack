// @ts-check
/**
 * @import {
 *   DomstackManifestEntry,
 *   DomstackManifestEntryPageMeta,
 *   DomstackManifestKind,
 *   DomstackManifest,
 *   GlobalDataFunctionParams,
 *   LayoutFunctionParams,
 *   PageFunctionParams,
 *   PageInfo,
 *   TemplateFunctionParams,
 *   TemplateInfo,
 * } from '../../index.js'
 */
import { test } from 'node:test'
import assert from 'node:assert'
import { readFile } from 'node:fs/promises'
import {
  DOMSTACK_MANIFEST_SCHEMA_ID,
  DOMSTACK_MANIFEST_SCHEMA_PATH,
  PageData,
  domstackManifestEntryPageMetaSchema,
  domstackManifestEntrySchema,
  domstackManifestKindSchema,
  domstackManifestSchema,
  getDomstackManifestSchemaId,
} from '../../index.js'

// Smoke test that public types are importable from the package entry point.
// The imports above are verified by TypeScript at compile time via `npm run test:tsc`.
/**
 * @typedef {DomstackManifestEntry} ImportedDomstackManifestEntry
 * @typedef {DomstackManifestEntryPageMeta} ImportedDomstackManifestEntryPageMeta
 * @typedef {DomstackManifestKind} ImportedDomstackManifestKind
 * @typedef {DomstackManifest} ImportedDomstackManifest
 * @typedef {GlobalDataFunctionParams} ImportedGlobalDataFunctionParams
 * @typedef {LayoutFunctionParams<any>} ImportedLayoutFunctionParams
 * @typedef {PageFunctionParams<any>} ImportedPageFunctionParams
 * @typedef {PageInfo} ImportedPageInfo
 * @typedef {TemplateFunctionParams} ImportedTemplateFunctionParams
 * @typedef {TemplateInfo} ImportedTemplateInfo
 */

test('PageData is importable from the package entry point', () => {
  assert.strictEqual(typeof PageData, 'function', 'PageData is a class')
})

test('domstack manifest schemas are importable from the package entry point', async () => {
  const [schemaJson, packageJson] = await Promise.all([
    readFile(new URL('../../lib/domstack-manifest/schema.json', import.meta.url), 'utf8'),
    readFile(new URL('../../package.json', import.meta.url), 'utf8'),
  ])
  const schemaFile = JSON.parse(schemaJson)
  const packageInfo = JSON.parse(packageJson)

  assert.deepStrictEqual(
    schemaFile,
    domstackManifestSchema,
    'packaged schema.json matches exported schema'
  )
  assert.ok(
    DOMSTACK_MANIFEST_SCHEMA_ID.includes(`@${packageInfo.version}/`),
    'manifest schema ID includes the package version'
  )
  assert.strictEqual(
    DOMSTACK_MANIFEST_SCHEMA_ID,
    getDomstackManifestSchemaId(packageInfo.version),
    'schema ID helper builds the exported schema ID from the package version'
  )
  assert.strictEqual(
    DOMSTACK_MANIFEST_SCHEMA_PATH,
    'lib/domstack-manifest/schema.json',
    'schema path points at the packaged JSON schema'
  )
  assert.strictEqual(
    domstackManifestSchema.$id,
    DOMSTACK_MANIFEST_SCHEMA_ID,
    'manifest schema uses exported schema ID'
  )
  assert.strictEqual(
    domstackManifestSchema.properties.$schema.const,
    DOMSTACK_MANIFEST_SCHEMA_ID,
    'manifest instance schema field uses exported schema ID'
  )
  assert.ok(domstackManifestKindSchema.enum.includes('page'), 'kind schema includes pages')
  assert.strictEqual(
    domstackManifestEntrySchema.properties.page,
    domstackManifestEntryPageMetaSchema,
    'entry schema uses page metadata schema'
  )
  assert.strictEqual(
    domstackManifestSchema.properties.entries.items,
    domstackManifestEntrySchema,
    'manifest schema uses entry schema'
  )
})
