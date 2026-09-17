/**
 * @import { BuildStepWarnings, SiteData } from '../builder.js'
 * @import { WorkerBuildStepResult } from '../build-pages/index.js'
 * @import { PageInfo, TemplateInfo } from '../identify-pages.js'
 * @import { DomstackManifestRecord } from '../domstack-manifest/index.js'
 */
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { inspect } from 'node:util'
import pino from 'pino'
import { buildLogger, logRebuildTree } from './logging.js'

/** @param {string} [level] */
function recordingLogger (level = 'info') {
  /** @type {{ level: number, msg: string }[]} */
  const records = []
  const logger = pino({ level }, {
    write (chunk) {
      const { level, msg } = JSON.parse(chunk)
      records.push({ level, msg })
    },
  })
  return { logger, records }
}

const dest = resolve('logging-test-output')
const warnings = /** @type {BuildStepWarnings} */ ([
  { message: 'Page warning' },
  { text: 'Bundler warning' },
])
const warningRecords = [
  { level: 40, msg: 'There were build warnings:' },
  { level: 40, msg: '  Page warning' },
  { level: 40, msg: inspect(warnings[1], { depth: 999, colors: true }) },
]

/** @returns {WorkerBuildStepResult} */
function buildResults () {
  // Only fields read by the logger are needed on these manifest records.
  const outputs = /** @type {DomstackManifestRecord[]} */ ([
    { kind: 'page', filepath: join(dest, 'index.html'), outputRelname: 'index.html' },
    { kind: 'template', filepath: join(dest, 'feed.xml'), sourceRelname: 'feed.template.js', templatePath: '/src/first.js' },
    { kind: 'template', filepath: join(dest, 'feed.json'), sourceRelname: 'feed.template.js', templatePath: '/src/second.js' },
    { kind: 'template', filepath: join(dest, 'legacy.xml'), templatePath: '/src/legacy.template.js' },
    { kind: 'template', filepath: join(dest, 'legacy.json'), templatePath: '/src/legacy.template.js' },
    { kind: 'template', filepath: join(dest, 'fallback.xml'), outputRelname: 'fallback.xml' },
    { kind: 'static', filepath: join(dest, 'asset.txt'), outputRelname: 'asset.txt' },
  ])
  return { type: 'page', warnings, errors: [], outputs, report: { pages: [], templates: [] } }
}

test('info rebuild trees preserve text, insertion order, and Set deduplication', () => {
  const { logger, records } = recordingLogger()
  const home = /** @type {PageInfo} */ ({ outputRelname: 'index.html' })
  const other = /** @type {PageInfo} */ ({ outputRelname: 'other/index.html' })
  const template = /** @type {TemplateInfo} */ ({ outputName: 'feed.xml' })
  logRebuildTree('shared.js', logger, new Set([other, home, other]), new Set([template, template]))
  logRebuildTree('empty.js', logger)
  assert.deepEqual(records, [
    { level: 30, msg: '"shared.js" changed:\n  → other/index.html\n  → index.html\n  → feed.xml (template)' },
    { level: 30, msg: '"empty.js" changed:' },
  ])
})

test('info full-build logs preserve warnings, source totals, and deduplicated output totals', () => {
  const { logger, records } = recordingLogger()
  const pageBuildResults = buildResults()
  // The full-build logger only reads collection sizes from discovery data.
  const siteData = /** @type {SiteData} */ (/** @type {unknown} */ ({
    pages: [{}, {}],
    layouts: { root: {}, article: {} },
    templates: [{}, {}, {}],
  }))
  buildLogger({ warnings, siteData, pageBuildResults: { ...pageBuildResults, errors: [] } }, logger)
  assert.deepEqual(records, [
    ...warningRecords,
    { level: 30, msg: 'Source pages: 2 Layouts: 2 Templates: 3' },
    { level: 30, msg: 'Pages built: 1 Templates built: 3' },
    { level: 30, msg: 'Build Success!' },
  ])
})

for (const withDest of [true, false]) {
  test(`info filtered-build logs preserve order and template deduplication ${withDest ? 'with' : 'without'} a destination`, () => {
    const { logger, records } = recordingLogger()
    buildLogger(buildResults(), logger, withDest ? dest : undefined)
    assert.deepEqual(records, [
      ...warningRecords,
      ...(withDest
        ? ['index.html', 'feed.xml', 'feed.json', 'legacy.xml', 'legacy.json', 'fallback.xml']
            .map(name => ({ level: 30, msg: `  Built ${name}` }))
        : []),
      { level: 30, msg: 'Pages built: 1 Templates built: 3' },
      { level: 30, msg: 'Build Success!' },
    ])
  })
}

for (const level of ['warn', 'silent']) {
  test(`${level} rebuild-tree logging does not iterate pages or templates`, t => {
    const { logger, records } = recordingLogger(level)
    const pages = new Set(/** @type {PageInfo[]} */ ([]))
    const templates = new Set(/** @type {TemplateInfo[]} */ ([]))
    t.mock.method(pages, Symbol.iterator, () => assert.fail('pages must not be iterated'))
    t.mock.method(templates, Symbol.iterator, () => assert.fail('templates must not be iterated'))
    logRebuildTree('shared.js', logger, pages, templates)
    assert.deepEqual(records, [])
  })

  test(`${level} full-build logging preserves warnings without reading site totals or outputs`, () => {
    const { logger, records } = recordingLogger(level)
    buildLogger({
      warnings,
      get siteData () { return assert.fail('site totals must not be read') },
      get pageBuildResults () { return assert.fail('outputs must not be read') },
    }, logger)
    assert.deepEqual(records, level === 'warn' ? warningRecords : [])
  })

  test(`${level} filtered-build logging preserves warnings without iterating outputs`, () => {
    const { logger, records } = recordingLogger(level)
    const results = buildResults()
    Object.defineProperty(results.outputs, Symbol.iterator, {
      value: () => assert.fail('outputs must not be iterated'),
    })
    buildLogger(results, logger, dest)
    buildLogger({ ...results, warnings: [] }, logger)
    assert.deepEqual(records, level === 'warn' ? warningRecords : [])
  })
}

test('loggers without level inspection retain info and warning output', () => {
  const { logger, records } = recordingLogger()
  Object.defineProperty(logger, 'isLevelEnabled', { value: undefined })
  logRebuildTree('page.md', logger)
  buildLogger({ warnings }, logger)
  assert.deepEqual(records, [
    { level: 30, msg: '"page.md" changed:' },
    ...warningRecords,
    { level: 30, msg: 'Build Success!' },
  ])
})

test('info guards follow logger-level changes on every invocation', () => {
  const { logger, records } = recordingLogger('warn')
  for (const level of ['warn', 'info', 'silent', 'info']) {
    logger.level = level
    logRebuildTree('page.md', logger)
    buildLogger({}, logger)
  }
  assert.deepEqual(records, [
    { level: 30, msg: '"page.md" changed:' },
    { level: 30, msg: 'Build Success!' },
    { level: 30, msg: '"page.md" changed:' },
    { level: 30, msg: 'Build Success!' },
  ])
})
