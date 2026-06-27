// @ts-nocheck

export default function concreteOnlyPages ({ pages }) {
  return {
    outputName: 'generated-introspection/index.html',
    vars: {
      layout: 'root',
      title: 'Generated introspection',
      sawGenerated: pages.some(page => page.pageInfo.type === 'generated'),
      concreteCount: pages.length,
    },
    children: ({ vars }) => `<p id="saw-generated">${vars.sawGenerated}</p><p id="concrete-count">${vars.concreteCount}</p>`,
  }
}
