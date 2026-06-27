export default async function * asyncPages () {
  yield {
    outputName: 'async-generated/index.html',
    vars: {
      layout: 'root',
      title: 'Async generated',
    },
    children: '<p id="async-generated">async generated page</p>',
  }
}
