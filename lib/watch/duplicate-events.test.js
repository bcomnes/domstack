/** @import { TestContext } from 'node:test' */
import assert from 'node:assert/strict'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { article, assertDelta, fixture, waitFor } from './incremental-global-data-tests/helpers.js'

const options = { timeout: 30_000 }

/** @param {TestContext} t */
async function countedFixture (t) {
  return fixture(t, {
    files: {
      'global.vars.js': "export default { layout: 'root' }",
      'root.layout.js': `import { appendFileSync } from 'node:fs'
        appendFileSync(new URL('../builds.log', import.meta.url), 'build\\n')
        export default ({ children }) => children`,
      // A page-output hook runs during output selection, not the producer's
      // renderFullPage call. All counters live outside the watched source tree.
      'a/page.vars.js': `import { appendFileSync } from 'node:fs'
        export const pageOutputs = ({ vars }) => {
          appendFileSync(new URL('../../html.log', import.meta.url), vars.title + '\\n')
          return []
        }`,
      'data.json.template.js': `/** @import { IndexRow } from './global.data.js' */
        import { appendFileSync } from 'node:fs'
        export const dataDeps = ['index']
        /** @param {{ data: { index: IndexRow[] } }} params */
        export default ({ data }) => {
          appendFileSync(new URL('../templates.log', import.meta.url), data.index[0].title + '\\n')
          return JSON.stringify(data.index)
        }`,
    },
  })
}

/** @param {{ src: string }} site @param {string} name */
async function lines (site, name) {
  return (await readFile(join(site.src, '..', name), 'utf8')).trim().split('\n')
}

/**
 * @param {Awaited<ReturnType<typeof countedFixture>>} site
 * @param {string[]} htmlTitles Includes the initial build.
 * @param {string[]} templateTitles Includes the initial build.
 */
async function assertRuns (site, htmlTitles, templateTitles) {
  await site.dom.settled()
  // With fake source delivery there are no later native callbacks to await.
  // Give an accidentally rescheduled drain another turn before counting.
  await nextTurn()
  await site.dom.settled()
  assert.equal((await lines(site, 'builds.log')).length, htmlTitles.length, 'exact build-worker count')
  assert.equal((await site.calls()).length, htmlTitles.length, 'exact producer invocation count')
  assert.deepEqual(await lines(site, 'html.log'), htmlTitles, 'HTML selected once per expected build')
  assert.deepEqual(await lines(site, 'templates.log'), templateTitles, 'subscriber runs only when published data changes')
}

test('same-turn duplicate callbacks build once with events retained', options, async t => {
  const site = await countedFixture(t)
  await site.start()
  await assertRuns(site, ['Alpha'], ['Alpha'])

  await site.write('a/page.md', article('Coalesced Alpha'))
  const events = [site.event('a/page.md'), site.event('a/page.md')]
  const coalesced = await site.rebuild(events)
  assertDelta(coalesced, ['a/page.md'])
  assert.deepEqual(coalesced.events, events, 'both callbacks remain in delivery order')
  assert.deepEqual(coalesced.rendered, ['a/page.md'], 'duplicate input renders once in this batch')
  await assertRuns(site, ['Alpha', 'Coalesced Alpha'], ['Alpha', 'Coalesced Alpha'])
  assert.match(await readFile(join(site.dest, 'a/index.html'), 'utf8'), /Coalesced Alpha/)
  assert.equal((await site.data())[0]?.title, 'Coalesced Alpha')
})

test('a second same-path edit during an active build survives in HTML and subscriber output', options, async t => {
  const site = await countedFixture(t)
  await site.start()
  const event = site.event('a/page.md')

  await writeFile(site.gate, '')
  try {
    await site.write('a/page.md', article('First Alpha', 'First body.'))
    site.emit([event])
    // The producer captures its inputs before waiting to publish data and outputs.
    await waitFor(async () => (await site.calls()).length === 2, 'first edit reaches the producer gate')
    assert.deepEqual(await lines(site, 'html.log'), ['Alpha'])
    assert.deepEqual(await lines(site, 'templates.log'), ['Alpha'])
    await site.write('a/page.md', article('Second Alpha', 'Second body.'))
    site.emit([event])
  } finally {
    await rm(site.gate, { force: true })
    await site.dom.settled()
  }

  await assertRuns(site, ['Alpha', 'First Alpha', 'Second Alpha'], ['Alpha', 'First Alpha', 'Second Alpha'])
  const calls = await site.calls()
  for (const call of calls.slice(1)) {
    assertDelta(call, ['a/page.md'])
    assert.deepEqual(call.events, [event], 'each detached batch owns one callback')
    assert.deepEqual(call.rendered, ['a/page.md'])
  }
  const html = await readFile(join(site.dest, 'a/index.html'), 'utf8')
  assert.match(html, /Second Alpha/)
  assert.match(html, /Second body\./)
  assert.doesNotMatch(html, /First Alpha|First body/)
  const data = await site.data()
  assert.equal(data[0]?.title, 'Second Alpha')
  assert.match(data[0]?.html ?? '', /Second body\./)
  assert.doesNotMatch(data[0]?.html ?? '', /First Alpha|First body/)
  assert.equal(data[1]?.title, 'Beta', 'unrelated cached row is retained')
})
