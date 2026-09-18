/**
 * @import { buildPages as WorkerBuildPages } from '../lib/build-pages/worker/index.js'
 * @import { identifyPages as IdentifyPages } from '../lib/identify-pages.js'
 * @import { PageBuildStepResult, BuildPagesOptions } from '../lib/build-pages/index.js'
 */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { cpus, release, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

// Compare trusted package snapshots with externally supplied identical dependencies using fresh, unmodified workers.
const { values } = parseArgs({
  options: {
    baseline: { type: 'string' },
    candidate: { type: 'string' },
    iterations: { type: 'string', default: '10' },
    warmup: { type: 'string', default: '1' },
    pages: { type: 'string', default: '24' },
  }
})
assert.ok(values.baseline, '--baseline PATH must name a trusted package root')
assert.ok(values.candidate, '--candidate PATH must name a trusted package root')
const iterations = Number(values.iterations)
const warmup = Number(values.warmup)
const pages = Number(values.pages)
assert.ok(Number.isSafeInteger(iterations) && iterations > 0, '--iterations must be a positive integer')
assert.ok(Number.isSafeInteger(warmup) && warmup >= 0, '--warmup must be a nonnegative integer')
assert.ok(Number.isSafeInteger(pages) && pages > 0, '--pages must be a positive integer')
const drainMs = 100

/** @typedef {'baseline' | 'candidate'} VariantName */
/** @typedef {{ pair: number, warmup: boolean, order: VariantName[], baselineMs: number, candidateMs: number }} Sample */

/**
 * @param {string} path
 */
async function loadVariant (path) {
  const root = await realpath(resolve(path))
  /** @type {{ buildPages: typeof WorkerBuildPages }} */
  const { buildPages } = await import(pathToFileURL(join(root, 'lib/build-pages/worker/index.js')).href)
  /** @type {{ identifyPages: typeof IdentifyPages }} */
  const { identifyPages } = await import(pathToFileURL(join(root, 'lib/identify-pages.js')).href)
  assert.equal(typeof buildPages, 'function', `${root}: missing worker buildPages`)
  assert.equal(typeof identifyPages, 'function', `${root}: missing identifyPages`)
  /** @type {{ name: string, version: string }} */
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  return { root, buildPages, identifyPages, package: { name: pkg.name, version: pkg.version } }
}

/** @param {number[]} samples */
function summarize (samples) {
  const sorted = [...samples].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return {
    count: sorted.length,
    medianMs: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
  }
}

/**
 * @param {PageBuildStepResult} result
 * @param {string} dest
 * @param {boolean} renderPage
 * @param {string} expectedTitles
 */
async function verify (result, dest, renderPage, expectedTitles) {
  assert.deepEqual(result.errors, [], 'build errors')
  assert.equal(result.type, 'page')
  assert.equal(result.report.pages.length, renderPage ? 1 : 0, 'rendered page count')
  assert.equal(result.report.templates.length, 1, 'rendered template count')
  assert.deepEqual(result.report.templates[0].outputs, ['titles.txt'])
  const expected = [join(dest, 'titles.txt')]
  if (renderPage) {
    const pagePath = join(dest, 'doc-1/index.html')
    expected.push(pagePath)
    assert.equal(result.report.pages[0].pageFilePath, pagePath)
    assert.deepEqual(result.report.pages[0].outputs.map(output => output.filepath), [pagePath])
    assert.match(await readFile(pagePath, 'utf8'), /<h1\b[^>]*>Doc 1<\/h1>/, 'rendered Markdown heading')
  }
  assert.deepEqual(result.outputs.map(output => output.filepath).sort(), expected.sort(), 'reported outputs')
  assert.equal(await readFile(join(dest, 'titles.txt'), 'utf8'), expectedTitles, 'all synchronous page titles')
  const entries = await readdir(dest, { recursive: true, withFileTypes: true })
  const files = entries.filter(entry => !entry.isDirectory()).map(entry => join(entry.parentPath, entry.name)).sort()
  assert.deepEqual(files, expected, 'no unwanted page outputs on disk')
}

const variants = {
  baseline: await loadVariant(values.baseline),
  candidate: await loadVariant(values.candidate),
}
const startedAt = new Date().toISOString()
const root = await mkdtemp(join(tmpdir(), 'domstack-lazy-preparation-'))
try {
  const src = join(root, 'src')
  await mkdir(src)
  await writeFile(join(root, 'package.json'), '{"type":"module"}\n')
  await writeFile(join(src, 'root.layout.js'), 'export default ({ children }) => children\n')
  await writeFile(join(src, 'global.vars.js'), 'export default { handlebars: false }\n')
  await writeFile(join(src, 'global.data.js'), 'export default ({ pages }) => ({ titles: pages.map(page => page.vars.title) })\n')
  const templatePath = join(src, 'titles.txt.template.js')
  await writeFile(templatePath, "export const dataDeps = ['titles']\nexport default ({ data }) => [...data.titles].sort().join('\\n')\n")
  const titles = Array.from({ length: pages }, (_, index) => `Doc ${index + 1}`)
  for (let index = 0; index < pages; index++) {
    const dir = join(src, `doc-${index + 1}`)
    await mkdir(dir)
    await writeFile(join(dir, 'page.md'), `# ${titles[index]}\n\nDocument body ${index + 1}.\n`)
  }
  const expectedTitles = [...titles].sort().join('\n')
  const sites = {
    baseline: await variants.baseline.identifyPages(src),
    candidate: await variants.candidate.identifyPages(src),
  }
  for (const site of Object.values(sites)) {
    assert.deepEqual(site.errors, [], 'discovery errors')
    assert.equal(site.pages.length, pages, 'discovered page count')
    assert.ok(site.pages.every(page => page.type === 'md'), 'all source pages are Markdown')
    assert.deepEqual(site.templates.map(template => template.templateFile.filepath), [templatePath])
    assert.equal(site.pagesFiles.length, 0)
  }

  const results = []
  let nextPair = 0
  for (const scenario of [
    { name: 'template-only', renderPage: false },
    { name: 'one-page-render', renderPage: true },
  ]) {
    /** @type {BuildPagesOptions} */
    const options = {
      pageFilterPaths: scenario.renderPage ? [join(src, 'doc-1/page.md')] : [],
      templateFilterPaths: [templatePath],
      pagesFileFilterPaths: [],
    }
    /** @type {Sample[]} */
    const samples = []
    for (let index = 0; index < warmup + iterations; index++) {
      const pair = nextPair++
      /** @type {VariantName[]} */
      const order = pair % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline']
      /** @type {Sample} */
      const sample = { pair, warmup: index < warmup, order, baselineMs: 0, candidateMs: 0 }
      for (const name of order) {
        const dest = join(root, `${scenario.name}-${index}-${name}`)
        await mkdir(dest)
        const { buildPages } = variants[name]
        const site = sites[name]
        let result
        let elapsed
        try {
          const start = performance.now()
          result = await buildPages(src, dest, site, options)
          elapsed = performance.now() - start
        } finally {
          // The public API resolves on message rather than exit, so allow worker teardown before another build.
          await delay(drainMs)
        }
        sample[name === 'baseline' ? 'baselineMs' : 'candidateMs'] = elapsed
        await verify(result, dest, scenario.renderPage, expectedTitles)
        await rm(dest, { recursive: true, force: true })
      }
      samples.push(sample)
    }
    const measured = samples.filter(sample => !sample.warmup)
    results.push({
      scenario: scenario.name,
      expected: { sourcePages: pages, renderedPages: scenario.renderPage ? 1 : 0, templates: 1, outputs: scenario.renderPage ? 2 : 1 },
      baseline: summarize(measured.map(sample => sample.baselineMs)),
      candidate: summarize(measured.map(sample => sample.candidateMs)),
      samples,
    })
  }
  console.log(JSON.stringify({
    environment: {
      startedAt,
      node: process.version,
      versions: process.versions,
      platform: process.platform,
      arch: process.arch,
      release: release(),
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      execPath: process.execPath,
      execArgv: process.execArgv,
      nodeOptions: process.env['NODE_OPTIONS'] ?? null,
    },
    packages: {
      baseline: { root: variants.baseline.root, ...variants.baseline.package },
      candidate: { root: variants.candidate.root, ...variants.candidate.package },
    },
    config: { iterations, warmup, pages, drainMs },
    protocol: 'Serial pairs alternate variant order globally; every call uses the package normal fresh worker without prewarming or retained build state; only parent buildPages call-to-result is timed, including worker startup and output writes; imports, fixture setup, discovery, assertions, cleanup and the 100 ms post-result drain are excluded; warmups are retained but excluded from median and nearest-rank p95; installed dependencies must be identical and supplied externally; no forced GC, filesystem cache flushing or timing thresholds.',
    results,
  }, null, 2))
} finally {
  await rm(root, { recursive: true, force: true })
}
