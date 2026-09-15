/** @import { IndexRow } from './global.data.js' */
import { existsSync } from 'node:fs'

const renderFailure = new URL('../fail-render', import.meta.url)

export const dataDeps = ['index']

/** @param {{ data: { index: IndexRow[] } }} params */
export default function dataTemplate ({ data }) {
  if (existsSync(renderFailure)) throw new Error('intentional later render failure')
  return JSON.stringify(data.index)
}
