import { createSessionRegistry } from '@domstack/sync'

/** @param {string | undefined} id @param {boolean} json */
export async function showWatchSessions (id, json) {
  const registry = createSessionRegistry()
  try {
    if (id !== undefined) {
      const record = await registry.get(id)
      if (record?.kind !== 'domstack-watch') {
        console.error(`domstack: No active watch session: ${id}`)
        process.exitCode = 1
        return
      }
      if (json) console.log(JSON.stringify(record))
      else {
        console.log(`Watch session ${record.id} (${record.state}, PID ${record.pid})`)
        console.log(`Started:     ${new Date(record.startedAt).toISOString()}`)
        console.log(`Project:     ${record.cwd}`)
        console.log(`Source:      ${record.source}`)
        console.log(`Destination: ${record.destination}`)
        console.log(`Site:        ${record.url ?? 'not serving'}`)
        console.log(`UI:          ${record.uiUrl ?? 'not serving'}`)
      }
      return
    }
    const records = (await registry.list()).filter(record => record.kind === 'domstack-watch')
    if (json) console.log(JSON.stringify(records))
    else if (records.length === 0) console.log('No active DOMStack watch sessions.')
    else {
      for (const record of records) {
        console.log(`${record.id}  ${record.state}  ${record.source} → ${record.destination}  ${record.url ?? '(no server)'}`)
      }
    }
  } catch (error) {
    console.error(`domstack: Could not read watch sessions: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
