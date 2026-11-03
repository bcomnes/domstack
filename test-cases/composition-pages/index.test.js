import assert from 'node:assert/strict'
import { test } from 'node:test'
import { join } from 'node:path'
import * as cheerio from 'cheerio'
import { testBuild } from '../../index.js'

test('composition filenames render explicitly without automatic pages or sidecars', async t => {
  const src = join(import.meta.dirname, 'src')
  const build = await testBuild(src)
  t.after(() => build.cleanup())

  const home = cheerio.load(await build.readOutput('index.html'))
  assert.equal(home('h1').first().text(), 'Composition pages')
  assert.equal(home('section.shared-layout').first().attr('data-compose'), 'false')
  assert.deepEqual(home('#slides > article').toArray().map(slide => ({
    title: home(slide).find('h1').text(),
    compose: home(slide).attr('data-compose'),
  })), [
    { title: 'First slide', compose: 'true' },
    { title: 'Second slide', compose: 'true' },
  ])
  assert.equal(home('#slides .shared-layout').length, 0, 'inner rendering excludes the shared layout')
  assert.match(home('#slides').text(), /Compose pages without publishing them/)
  assert.equal(home('#slides strong').text(), 'Markdown')
  assert.equal(home('#explicit-preview > .shared-layout').attr('data-compose'), 'true',
    'explicit full rendering still applies the shared layout to a composition page')
  assert.equal(home('#explicit-preview h1').text(), 'First slide')
  assert.deepEqual(home('#page-compositions li').toArray().map(item => ({
    source: home(item).attr('data-source'),
    compose: home(item).attr('data-compose'),
  })), [
    { source: 'default.md', compose: 'false' },
    { source: 'explicit.md', compose: 'false' },
    { source: 'page.js', compose: 'false' },
    { source: 'slides/chapter.compose.md', compose: 'true' },
    { source: 'slides/page.compose.md', compose: 'true' },
  ], 'global data sees the discovered composition flag for every page')

  for (const [name, heading] of [['explicit', 'Explicitly emitted'], ['default', 'Emitted by default']]) {
    const page = cheerio.load(await build.readOutput(`${name}.html`))
    assert.equal(page('.shared-layout').attr('data-compose'), 'false')
    assert.equal(page('h1').text(), heading)
  }
  for (const output of ['index.html', 'explicit.html', 'default.html']) {
    assert.deepEqual(JSON.parse(await build.readOutput(`${output}.layout.json`)), {
      url: output === 'index.html' ? '/' : `/${output}`,
      compose: false,
    }, 'normal pages still run the shared layout output hook')
  }

  for (const name of ['index', 'chapter']) {
    for (const suffix of ['', '.layout.json', '.slide.json']) {
      await assert.rejects(build.readOutput(`slides/${name}.html${suffix}`), { code: 'ENOENT' })
    }
  }

  const pageResults = build.results.pageBuildResults
  assert.ok(pageResults)
  assert.deepEqual(pageResults.outputs.map(output => output.outputRelname).sort(), [
    'default.html', 'default.html.layout.json',
    'explicit.html', 'explicit.html.layout.json',
    'index.html', 'index.html.layout.json',
  ], 'the output manifest contains only normal pages and their sidecars')
  const pageReports = pageResults.report.pages
  assert.ok(pageReports)
  assert.equal(pageReports.length, 5)
  /** @type {[string, string][]} */
  const compositionOutputs = [['page.compose.md', 'index.html'], ['chapter.compose.md', 'chapter.html']]
  for (const [source, output] of compositionOutputs) {
    const report = pageReports.find(page => page.sourcePageFilePath === join(src, 'slides', source))
    assert.ok(report, 'composition slides remain in the page build report')
    assert.equal(report.pageFilePath, join(build.dest, 'slides', output))
    assert.deepEqual(report.outputs, [], 'composition slides own no automatic outputs')
  }
  for (const source of ['page.js', 'explicit.md', 'default.md']) {
    const report = pageReports.find(page => page.sourcePageFilePath === join(src, source))
    assert.ok(report)
    assert.ok(report.outputs)
    assert.equal(report.outputs.length, 2, 'normal pages report primary and layout outputs')
  }
})
