// @ts-check
import { test } from 'node:test'
import assert from 'node:assert'
import { PageData } from '../../index.js'

/**
 * Smoke test that all public types are importable from the package entry point.
 * The @typedef imports below are verified by TypeScript at compile time via `npm run test:tsc`.
 *
 * @typedef {import('../../index.js').PageInfo} PageInfo
 * @typedef {import('../../index.js').TemplateInfo} TemplateInfo
 * @typedef {import('../../index.js').LayoutFunctionParams} LayoutFunctionParams
 * @typedef {import('../../index.js').GlobalDataFunctionParams} GlobalDataFunctionParams
 * @typedef {import('../../index.js').PageFunctionParams} PageFunctionParams
 * @typedef {import('../../index.js').TemplateFunctionParams} TemplateFunctionParams
 */

test('PageData is importable from the package entry point', () => {
  assert.strictEqual(typeof PageData, 'function', 'PageData is a class')
})
