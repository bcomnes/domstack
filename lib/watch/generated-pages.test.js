import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DomStack } from '../../index.js'
import { readFile, stat, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { editAndWait, startWatch } from './test-helpers.js'
import { withTempFixture, minimalRootLayout, minimalGlobalVars, assetAwareRootLayout } from '../build-pages/generated-pages/test-helpers.js'

test('rebuilds declared subscribers when a global-data key changes', { timeout: 15_000 }, async t => {
  await withTempFixture({
    'root.layout.js': minimalRootLayout,
    'global.vars.js': minimalGlobalVars,
    'page.js': 'export default ({ vars }) => vars.title\n',
    'page.vars.js': "export default { title: 'First title' }\n",
    'global.data.js': `export default function ({ pages }) {
  return { sourceTitle: pages[0].vars.title }
}
`,
    'watch-indexes.pages.js': `export const dataDeps = ['sourceTitle']
export default function ({ data }) {
  const title = data.sourceTitle
  const outputName = title === 'First title'
    ? 'watch-first/index.html'
    : 'watch-updated/index.html'
  return { outputName, vars: { title }, children: () => title }
}
`,
    'summary.template.js': `export const dataDeps = ['sourceTitle']
export default function ({ data }) {
  const outputName = data.sourceTitle === 'First title'
    ? 'watch-first/index.html'
    : 'watch-updated/index.html'
  return outputName + ':' + data.sourceTitle
}
`,
    'unrelated.pages.js': `import { appendFileSync } from 'node:fs'

export default function unrelatedPages () {
  appendFileSync(new URL('../unrelated-factory-runs', import.meta.url), 'run\\n')
  return { outputName: 'unrelated/index.html', children: 'Unrelated' }
}
`,
  }, async ({ src, dest }) => {
    const domstack = new DomStack(src, dest)
    const factoryRuns = join(src, '../unrelated-factory-runs')
    try {
      await startWatch(t, domstack, src, {
        serve: false,
        async onInitialBuild () {
          assert.equal(await readFile(factoryRuns, 'utf8'), 'run\n', 'the unrelated factory ran during the initial build')
        },
      })
      const initialOutputPath = join(dest, 'watch-first/index.html')
      const updatedOutputPath = join(dest, 'watch-updated/index.html')
      assert.match(await readFile(initialOutputPath, 'utf8'), /First title/)
      assert.equal(await readFile(join(dest, 'summary'), 'utf8'), 'watch-first/index.html:First title')
      const startupFactoryRuns = await readFile(factoryRuns, 'utf8')

      await editAndWait(domstack, join(src, 'page.vars.js'), () => writeFile(join(src, 'page.vars.js'), "export default { title: 'Updated title' }\n"))

      const updatedOutput = await readFile(updatedOutputPath, 'utf8')
      assert.match(updatedOutput, /Updated title/)
      assert.doesNotMatch(updatedOutput, /First title/)
      assert.equal(await readFile(join(dest, 'summary'), 'utf8'), 'watch-updated/index.html:Updated title')
      await assert.rejects(() => stat(initialOutputPath), { code: 'ENOENT' }, 'obsolete dependency-driven output is removed')
      assert.equal(await readFile(factoryRuns, 'utf8'), startupFactoryRuns, 'an unrelated factory is not executed during a subscriber rebuild')
    } finally {
      if (domstack.watching) await domstack.stopWatching()
    }
  })
})

test('rebuilds generated pages when Markdown settings change in watch mode', { timeout: 15_000 }, async t => {
  const markdownSettings = (/** @type {string} */ version) => `export default function (md) {
  md.renderer.rules.paragraph_open = () => '<p data-version="${version}">'
  return md
}
`

  await withTempFixture({
    'root.layout.js': minimalRootLayout,
    'global.vars.js': minimalGlobalVars,
    'post.md': 'Rendered post\n',
    'markdown-it.settings.js': markdownSettings('first'),
    'global.data.js': `export default async function ({ pages }) {
  const post = pages.find(page => page.pageInfo.pageFile.relname === 'post.md')
  if (!post) throw new Error('Missing Markdown post')
  return { renderedPost: await post.renderInnerPage() }
}
`,
    'markdown-summary.pages.js': `export const dataDeps = ['renderedPost']
export default function ({ data }) {
  return { outputName: 'summary/index.html', children: data.renderedPost }
}
`,
  }, async ({ src, dest }) => {
    const domstack = new DomStack(src, dest)
    const outputPath = join(dest, 'summary/index.html')

    try {
      await startWatch(t, domstack, src)
      assert.match(await readFile(outputPath, 'utf8'), /data-version="first"/)

      await editAndWait(domstack, join(src, 'markdown-it.settings.js'), () => writeFile(join(src, 'markdown-it.settings.js'), markdownSettings('second')))

      const updatedOutput = await readFile(outputPath, 'utf8')
      assert.match(updatedOutput, /data-version="second"/)
      assert.doesNotMatch(updatedOutput, /data-version="first"/)
    } finally {
      if (domstack.watching) await domstack.stopWatching()
    }
  })
})

test('rebuilds generated pages when layout assets are added or removed in watch mode', { timeout: 25_000 }, async t => {
  await withTempFixture({
    'root.layout.js': assetAwareRootLayout,
    'global.vars.js': minimalGlobalVars,
    'page.js': "export default () => 'Regular page'\n",
    'layout-assets.pages.js': `export default {
  outputName: 'generated/index.html',
  children: 'Generated page',
}
`,
  }, async ({ src, dest }) => {
    const domstack = new DomStack(src, dest)
    const regularOutputPath = join(dest, 'index.html')
    const generatedOutputPath = join(dest, 'generated/index.html')

    /**
       * @param {string} assetName
       * @param {boolean} expected
       */
    const assertAssetReference = async (assetName, expected) => {
      const [regularHtml, generatedHtml] = await Promise.all([
        readFile(regularOutputPath, 'utf8'),
        readFile(generatedOutputPath, 'utf8'),
      ])
      assert.equal(regularHtml.includes(assetName), expected, `regular page ${expected ? 'includes' : 'omits'} ${assetName}`)
      assert.equal(generatedHtml.includes(assetName), expected, `generated page ${expected ? 'includes' : 'omits'} ${assetName}`)
    }

    try {
      await startWatch(t, domstack, src)
      await assertAssetReference('root.layout.css', false)
      await assertAssetReference('root.layout.client.js', false)

      await editAndWait(domstack, join(src, 'root.layout.css'), () => writeFile(join(src, 'root.layout.css'), 'body { color: red }\n'))
      await assertAssetReference('root.layout.css', true)

      await editAndWait(domstack, join(src, 'root.layout.css'), () => rm(join(src, 'root.layout.css')))
      await assertAssetReference('root.layout.css', false)

      await editAndWait(domstack, join(src, 'root.layout.client.js'), () => writeFile(join(src, 'root.layout.client.js'), 'globalThis.layoutClientLoaded = true\n'))
      await assertAssetReference('root.layout.client.js', true)

      await editAndWait(domstack, join(src, 'root.layout.client.js'), () => rm(join(src, 'root.layout.client.js')))
      await assertAssetReference('root.layout.client.js', false)
    } finally {
      if (domstack.watching) await domstack.stopWatching()
    }
  })
})

test('removes obsolete regular and generated page outputs in watch mode', { timeout: 20_000 }, async t => {
  await withTempFixture({
    'root.layout.js': minimalRootLayout,
    'global.vars.js': minimalGlobalVars,
    'regular/page.html': '<p>Regular page</p>',
    'changing.pages.js': `export default [
  { outputName: 'old/index.html', children: 'Old generated page' },
  { outputName: 'removed/index.html', children: 'Removed generated page' },
  { outputName: 'drafted/index.html', children: 'Published generated page' },
]
`,
  }, async ({ src, dest }) => {
    const domstack = new DomStack(src, dest)
    try {
      await startWatch(t, domstack, src)
      const oldOutputPath = join(dest, 'old/index.html')
      const newOutputPath = join(dest, 'new/index.html')
      const removedOutputPath = join(dest, 'removed/index.html')
      const draftedOutputPath = join(dest, 'drafted/index.html')
      const regularOutputPath = join(dest, 'regular/index.html')

      assert.match(await readFile(oldOutputPath, 'utf8'), /Old generated page/)
      assert.match(await readFile(removedOutputPath, 'utf8'), /Removed generated page/)
      assert.match(await readFile(draftedOutputPath, 'utf8'), /Published generated page/)
      assert.match(await readFile(regularOutputPath, 'utf8'), /Regular page/)

      await editAndWait(domstack, join(src, 'changing.pages.js'), () => writeFile(join(src, 'changing.pages.js'), `export default [
  { outputName: 'new/index.html', children: 'Renamed generated page' },
  { outputName: 'drafted/index.html', children: 'Draft generated page', draft: true },
]
`))

      assert.match(await readFile(newOutputPath, 'utf8'), /Renamed generated page/)
      await assert.rejects(() => readFile(oldOutputPath, 'utf8'), { code: 'ENOENT' })
      await assert.rejects(() => readFile(removedOutputPath, 'utf8'), { code: 'ENOENT' })
      await assert.rejects(() => readFile(draftedOutputPath, 'utf8'), { code: 'ENOENT' })

      await editAndWait(domstack, join(src, 'regular/page.html'), () => rm(join(src, 'regular/page.html')))
      await assert.rejects(() => readFile(regularOutputPath, 'utf8'), { code: 'ENOENT' })

      await editAndWait(domstack, join(src, 'changing.pages.js'), () => rm(join(src, 'changing.pages.js')))
      await assert.rejects(() => readFile(newOutputPath, 'utf8'), { code: 'ENOENT' })
    } finally {
      if (domstack.watching) await domstack.stopWatching()
    }
  })
})
