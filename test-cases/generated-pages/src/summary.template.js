// @ts-nocheck

export default function summaryTemplate ({ pages, vars }) {
  return {
    outputName: 'summary.json',
    content: JSON.stringify({
      generatedPageCount: vars.generatedPageCount,
      generatedPagesInTemplate: pages.filter(page => page.pageInfo.type === 'generated').length,
    }, null, 2),
  }
}
