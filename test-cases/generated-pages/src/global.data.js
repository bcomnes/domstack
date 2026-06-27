/**
 * @import { GlobalDataFunction } from '#types'
 */

/** @type {GlobalDataFunction<{ generatedPageCount: number }>} */
export default function globalData ({ pages }) {
  return {
    generatedPageCount: pages.filter(page => Boolean(page.pageInfo.generated)).length,
  }
}
