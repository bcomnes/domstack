// @ts-check
/**
 * @import {
 *   BuildOutputEntry,
 *   BuildOutputEntryPageMeta,
 *   BuildOutputKind,
 *   BuildOutputManifest,
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
  BUILD_OUTPUT_MANIFEST_SCHEMA_ID,
  BUILD_OUTPUT_MANIFEST_SCHEMA_PATH,
  PageData,
  buildOutputEntryPageMetaSchema,
  buildOutputEntrySchema,
  buildOutputKindSchema,
  buildOutputManifestSchema,
  getBuildOutputManifestSchemaId,
} from '../../index.js'

// Smoke test that public types are importable from the package entry point.
// The imports above are verified by TypeScript at compile time via `npm run test:tsc`.
/**
 * @typedef {BuildOutputEntry} ImportedBuildOutputEntry
 * @typedef {BuildOutputEntryPageMeta} ImportedBuildOutputEntryPageMeta
 * @typedef {BuildOutputKind} ImportedBuildOutputKind
 * @typedef {BuildOutputManifest} ImportedBuildOutputManifest
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

test('build output manifest schemas are importable from the package entry point', async () => {
  const [schemaJson, packageJson] = await Promise.all([
    readFile(new URL('../../lib/build-output-manifest/schema.json', import.meta.url), 'utf8'),
    readFile(new URL('../../package.json', import.meta.url), 'utf8'),
  ])
  const schemaFile = JSON.parse(schemaJson)
  const packageInfo = JSON.parse(packageJson)

  assert.deepStrictEqual(
    schemaFile,
    buildOutputManifestSchema,
    'packaged schema.json matches exported schema'
  )
  assert.ok(
    BUILD_OUTPUT_MANIFEST_SCHEMA_ID.includes(`@${packageInfo.version}/`),
    'manifest schema ID includes the package version'
  )
  assert.strictEqual(
    BUILD_OUTPUT_MANIFEST_SCHEMA_ID,
    getBuildOutputManifestSchemaId(packageInfo.version),
    'schema ID helper builds the exported schema ID from the package version'
  )
  assert.strictEqual(
    BUILD_OUTPUT_MANIFEST_SCHEMA_PATH,
    'lib/build-output-manifest/schema.json',
    'schema path points at the packaged JSON schema'
  )
  assert.strictEqual(
    buildOutputManifestSchema.$id,
    BUILD_OUTPUT_MANIFEST_SCHEMA_ID,
    'manifest schema uses exported schema ID'
  )
  assert.strictEqual(
    buildOutputManifestSchema.properties.$schema.const,
    BUILD_OUTPUT_MANIFEST_SCHEMA_ID,
    'manifest instance schema field uses exported schema ID'
  )
  assert.ok(buildOutputKindSchema.enum.includes('page'), 'kind schema includes pages')
  assert.strictEqual(
    buildOutputEntrySchema.properties.page,
    buildOutputEntryPageMetaSchema,
    'entry schema uses page metadata schema'
  )
  assert.strictEqual(
    buildOutputManifestSchema.properties.entries.items,
    buildOutputEntrySchema,
    'manifest schema uses entry schema'
  )
})
