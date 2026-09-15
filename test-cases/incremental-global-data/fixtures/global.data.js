/**
 * @import { GlobalDataFunctionParams } from '@domstack/static/types.js'
 * @typedef {{ url: string, title: string, html: string }} IndexRow
 */
import { appendFileSync, existsSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { prefix } from './producer-middle.js'

const log = new URL('../producer.jsonl', import.meta.url)
const gate = new URL('../hold-producer', import.meta.url)
const producerFailure = new URL('../fail-producer', import.meta.url)

/** @param {GlobalDataFunctionParams<{ article?: boolean, title: string }, string, Map<string, IndexRow>>} params */
export default async function globalData ({ pages, previousState, changes, setState }) {
  const state = changes.kind === 'reset' ? new Map() : new Map(previousState)
  const rendered = []
  if (changes.kind === 'delta') {
    for (const sourceId of changes.removed) state.delete(sourceId)
  }
  for (const page of changes.kind === 'reset' ? pages : changes.upserted) {
    if (!page.vars.article) {
      state.delete(page.sourceId)
      continue
    }
    rendered.push(page.sourceId)
    state.set(page.sourceId, {
      url: page.pageInfo.url,
      title: page.vars.title,
      html: prefix + await page.renderFullPage(),
    })
  }
  setState(state)
  // Capture failure before the gate so a buffered retry can recover.
  const fail = existsSync(producerFailure)
  appendFileSync(log, JSON.stringify({
    kind: changes.kind,
    reason: changes.kind === 'reset' ? changes.reason : undefined,
    events: changes.events.map(({ type, filepath }) => ({ type, filepath })),
    upserted: changes.kind === 'delta' ? changes.upserted.map(page => page.sourceId).sort() : [],
    removed: changes.kind === 'delta' ? [...changes.removed].sort() : [],
    rendered: rendered.sort(),
    previousKeys: previousState === undefined ? null : [...previousState.keys()].sort(),
  }) + '\n')
  const deadline = Date.now() + 8000
  while (existsSync(gate)) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for test producer gate')
    await delay(10)
  }
  if (fail) throw new Error('intentional producer failure after setState')
  return { index: [...state.values()].sort((a, b) => a.url.localeCompare(b.url)) }
}
