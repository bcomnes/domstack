/** @import { WatchDependencyTracker as Tracker } from '../lib/build-pages/global-data/watch-dependencies.js' */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { deserialize } from 'node:v8'
import { WatchDependencyTracker } from '../lib/build-pages/global-data/watch-dependencies.js'

const { values } = parseArgs({
  options: {
    baseline: { type: 'string' },
    data: { type: 'string' },
    iterations: { type: 'string', default: '20' },
    warmup: { type: 'string', default: '3' },
  }
})
assert.ok(values.baseline, '--baseline must name a trusted local pre-change watch-dependencies.js snapshot')
const iterations = Number(values.iterations)
const warmup = Number(values.warmup)
assert.ok(Number.isSafeInteger(iterations) && iterations > 0)
assert.ok(Number.isSafeInteger(warmup) && warmup >= 0)
const { WatchDependencyTracker: Baseline } = await import(pathToFileURL(resolve(values.baseline)).href)
/** @type {{ name: string, data: Record<string, unknown> }[]} */
const fixtures = [
  { name: 'small-primitives', data: Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [String(i), [null, true, false, i, `value-${i}`][i % 5]])) },
  { name: 'large-string', data: { text: 'Title 日本語 😀\n"quoted" \\ path\n'.repeat(100_000) } },
  {
    name: 'structured-documents',
    data: {
      docs: Array.from({ length: 585 }, (_, i) => ({
        title: `Document ${i}`,
        url: `/docs/${i}/`,
        order: i,
        tags: ['a', 'b'],
        body: 'Markdown body with "quotes" and \nlines. '.repeat(300),
      }))
    }
  },
]
if (values.data) fixtures.push({ name: 'captured-producer-data', data: deserialize(await readFile(values.data)) })

/** @param {number[]} samples */
function stats (samples) {
  const sorted = [...samples].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return {
    medianMs: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    minMs: sorted[0],
    maxMs: sorted.at(-1)
  }
}

const results = []
for (const { name, data } of fixtures) {
  const reference = new Baseline(null, { fullBuild: true })
  reference.updateGlobalDataFingerprints(data, null)
  const previous = reference.state.globalDataFingerprints
  /** @type {{ baselineMs: number, candidateMs: number, order: string[] }[]} */
  const samples = []
  for (let index = -warmup; index < iterations; index++) {
    const order = index % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']
    const times = { baselineMs: 0, candidateMs: 0 }
    for (const variant of order) {
      /** @type {Tracker} */
      const tracker = new (variant === 'baseline' ? Baseline : WatchDependencyTracker)(null, { fullBuild: true })
      const start = performance.now()
      const changed = tracker.updateGlobalDataFingerprints(data, previous)
      const elapsed = performance.now() - start
      times[variant === 'baseline' ? 'baselineMs' : 'candidateMs'] = elapsed
      assert.deepEqual(tracker.state.globalDataFingerprints, previous, `${name}: exact fingerprint equivalence`)
      assert.deepEqual([...changed], Object.keys(previous).filter(key => previous[key] === null), `${name}: unchanged and opaque invalidation`)
    }
    if (index >= 0) samples.push({ ...times, order })
  }
  results.push({
    name,
    topLevelKeys: Object.keys(data).length,
    opaqueKeys: Object.values(previous).filter(value => value === null).length,
    baseline: stats(samples.map(sample => sample.baselineMs)),
    candidate: stats(samples.map(sample => sample.candidateMs)),
    pairedSaved: stats(samples.map(sample => sample.baselineMs - sample.candidateMs)),
    samples
  })
}
console.log(JSON.stringify({
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  iterations,
  warmup,
  protocol: 'Serial paired tracker updates, alternating implementation order; excludes setup and exact-hash assertions; includes hashing and key comparison; no forced GC or timing thresholds. Captured data must be trusted. Not end-to-end watch latency.',
  results
}, null, 2))
