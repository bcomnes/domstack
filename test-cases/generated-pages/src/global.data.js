// @ts-nocheck

export default function globalData ({ pages }) {
  return {
    generatedPageCount: pages.filter(page => page.pageInfo.type === 'generated').length,
  }
}
