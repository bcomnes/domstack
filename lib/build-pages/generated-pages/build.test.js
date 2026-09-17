import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DomStack } from '../../../index.js'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withTempFixture, minimalRootLayout, minimalGlobalVars, firstGeneratedPagesError } from './test-helpers.js'

test('supports static object, static array, and async function exports', async () => {
  await withTempFixture({
    'root.layout.js': minimalRootLayout,
    'global.vars.js': minimalGlobalVars,
    'single.pages.js': `export default {
  outputName: 'single/index.html',
  children: '<p>single static page</p>',
}
`,
    'multiple.pages.js': `export default [
  { outputName: 'multiple/one.html', children: '<p>first static page</p>' },
  { outputName: 'multiple/two.html', children: '<p>second static page</p>' },
]
`,
    'async.pages.js': `export default async function () {
  return { outputName: 'async/index.html', children: '<p>async function page</p>' }
}
`,
  }, async ({ src, dest }) => {
    const domstack = new DomStack(src, dest)
    await domstack.build()

    assert.match(await readFile(join(dest, 'single/index.html'), 'utf8'), /single static page/)
    assert.match(await readFile(join(dest, 'multiple/one.html'), 'utf8'), /first static page/)
    assert.match(await readFile(join(dest, 'multiple/two.html'), 'utf8'), /second static page/)
    assert.match(await readFile(join(dest, 'async/index.html'), 'utf8'), /async function page/)
  })
})

test('builds generated drafts when buildDrafts is enabled', async () => {
  await withTempFixture({
    'root.layout.js': minimalRootLayout,
    'global.vars.js': minimalGlobalVars,
    'draft.pages.js': `export default {
  outputName: 'draft/index.html',
  draft: true,
  children: '<p>generated draft</p>',
}
`,
  }, async ({ src, dest }) => {
    const domstack = new DomStack(src, dest, { buildDrafts: true })
    await domstack.build()

    assert.match(await readFile(join(dest, 'draft/index.html'), 'utf8'), /generated draft/)
  })
})

test('includes generated pages in the domstack manifest as page entries', async () => {
  await withTempFixture({
    'root.layout.js': minimalRootLayout,
    'global.vars.js': minimalGlobalVars,
    'archive.pages.js': `export default {
  outputName: 'archive/index.html',
  vars: {
    layout: 'root',
    title: 'Archive',
    archiveYear: 2024,
    manifestRole: 'generated-index',
  },
  children: '<p>Generated archive</p>',
}
`,
  }, async ({ src, dest }) => {
    const domstack = new DomStack(src, dest, {
      domstackManifest: {
        manifestVars: ['archiveYear'],
      },
    })
    const results = await domstack.build()
    const entry = results.domstackManifest?.entries.find(entry => entry.outputRelname === 'archive/index.html')
    const outputRecord = results.pageBuildResults?.outputs.find(output => output.outputRelname === 'archive/index.html')

    assert.ok(entry, 'generated page is present in the domstack manifest')
    assert.equal(outputRecord?.pageVars?.['archiveYear'], 2024, 'copyable page vars are returned from the worker')
    assert.equal(entry.kind, 'page')
    assert.equal(entry.url, '/archive/')
    assert.equal(entry.sourceRelname, 'archive.pages.js#0')
    assert.equal(entry.pagePath, 'archive')
    assert.equal(entry.pageUrl, '/archive/')
    assert.deepEqual(entry.page, {
      path: 'archive',
      url: '/archive/',
    })
    assert.equal(entry.role, 'generated-index', 'generated page vars can override the manifest role')
    assert.deepEqual(entry.manifestVars, {
      archiveYear: 2024,
    }, 'selected generated page vars are exposed in the manifest')
    assert.match(entry.revision ?? '', /^[a-f0-9]{64}$/, 'generated page content is revisioned')
  })
})

test('supports function manifest transforms with generated vars', async () => {
  await withTempFixture({
    'root.layout.js': minimalRootLayout,
    'global.vars.js': minimalGlobalVars,
    'archive.pages.js': `export default {
  outputName: 'archive/index.html',
  vars: {
    title: 'Archive',
    archive: { year: 2024 },
  },
  children ({ vars }) {
    vars.archive.year = 2025
    return '<p>Generated archive</p>'
  },
}
`,
  }, async ({ src, dest }) => {
    const domstack = new DomStack(src, dest, {
      domstackManifest: {
        manifestVars: ({ vars }) => {
          const archive = /** @type {{ year: number } | undefined} */ (vars['archive'])
          return archive ? { archiveLabel: String(archive.year) } : {}
        },
      },
    })
    const results = await domstack.build()
    const entry = results.domstackManifest?.entries.find(entry => entry.outputRelname === 'archive/index.html')
    const outputRecord = results.pageBuildResults?.outputs.find(output => output.outputRelname === 'archive/index.html')

    assert.deepEqual(entry?.manifestVars, { archiveLabel: '2025' })
    assert.deepEqual(outputRecord?.pageVars?.['archive'], { year: 2025 }, 'function transforms receive complete post-render page vars')
  })
})

test('throws a conflict error for generated pages that collide with concrete pages', async () => {
  await withTempFixture({
    'root.layout.js': minimalRootLayout,
    'global.vars.js': minimalGlobalVars,
    'README.md': '# Concrete root page\n',
    'conflict.pages.js': `export default function () {
  return { outputName: 'index.html', vars: { title: 'Generated root' }, children: 'generated' }
}
`,
  }, async ({ src, dest }) => {
    const domstack = new DomStack(src, dest)
    await assert.rejects(
      () => domstack.build(),
      error => {
        const generatedError = firstGeneratedPagesError(error)

        assert.match(generatedError.message, /Output path conflict/)
        assert.match(generatedError.message, /pages file: "conflict\.pages\.js"/)
        assert.equal(generatedError.code, 'DOM_STACK_ERROR_OUTPUT_CONFLICT')
        assert.deepEqual(generatedError.conflict, {
          outputPath: 'index.html',
          a: { type: 'page', path: 'README.md' },
          b: { type: 'page', path: 'conflict.pages.js#0' },
        })
        assert.equal(generatedError.pagesFile?.pagesFile.relname, 'conflict.pages.js')
        return true
      }
    )
  })
})

test('throws a conflict error with both generated page sources', async () => {
  await withTempFixture({
    'root.layout.js': minimalRootLayout,
    'global.vars.js': minimalGlobalVars,
    'first.pages.js': "export default { outputName: 'shared/index.html' }\n",
    'second.pages.js': "export default { outputName: 'shared/index.html' }\n",
  }, async ({ src, dest }) => {
    const domstack = new DomStack(src, dest)
    await assert.rejects(
      () => domstack.build(),
      error => {
        const generatedError = firstGeneratedPagesError(error)
        const conflictingSources = [
          generatedError.conflict?.a.path,
          generatedError.conflict?.b.path,
        ].sort()

        assert.equal(generatedError.code, 'DOM_STACK_ERROR_OUTPUT_CONFLICT')
        assert.equal(generatedError.conflict?.outputPath, 'shared/index.html')
        assert.deepEqual(conflictingSources, ['first.pages.js#0', 'second.pages.js#0'])
        assert.equal(`${generatedError.pagesFile?.pagesFile.relname}#0`, generatedError.conflict?.b.path)
        return true
      }
    )
  })
})

test('rejects invalid definitions returned in arrays', async () => {
  await withTempFixture({
    'root.layout.js': minimalRootLayout,
    'global.vars.js': minimalGlobalVars,
    'invalid.pages.js': 'export default [{ outputName: "valid/index.html", children: "Published before validation failure" }, 42]\n',
  }, async ({ src, dest }) => {
    const domstack = new DomStack(src, dest)
    await assert.rejects(
      () => domstack.build(),
      error => {
        const generatedError = firstGeneratedPagesError(error)

        assert.match(generatedError.message, /Generated page definition must be an object/)
        assert.match(generatedError.message, /pages file: "invalid\.pages\.js"/)
        assert.equal(generatedError.name, 'TypeError')
        assert.equal(generatedError.pagesFile?.pagesFile.relname, 'invalid.pages.js')
        return true
      }
    )
    assert.match(await readFile(join(dest, 'valid/index.html'), 'utf8'), /Published before validation failure/)
  })
})

test('throws a clear error for invalid generated page paths', async () => {
  await withTempFixture({
    'root.layout.js': minimalRootLayout,
    'global.vars.js': minimalGlobalVars,
    'invalid.pages.js': `export default function () {
  return { outputName: '../outside/index.html', vars: { title: 'Invalid' }, children: 'invalid' }
}
`,
  }, async ({ src, dest }) => {
    const domstack = new DomStack(src, dest)
    await assert.rejects(
      () => domstack.build(),
      error => {
        const generatedError = firstGeneratedPagesError(error)

        assert.match(generatedError.message, /must not contain "\.\." segments/)
        assert.match(generatedError.message, /pages file: "invalid\.pages\.js"/)
        assert.equal(generatedError.pagesFile?.pagesFile.relname, 'invalid.pages.js')
        return true
      }
    )
  })
})

test('rejects generated output names that do not name a file', async () => {
  for (const outputName of ['.', './', 'nested/']) {
    await withTempFixture({
      'root.layout.js': minimalRootLayout,
      'global.vars.js': minimalGlobalVars,
      'invalid.pages.js': `export default { outputName: ${JSON.stringify(outputName)}, children: 'invalid' }\n`,
    }, async ({ src, dest }) => {
      const domstack = new DomStack(src, dest)
      await assert.rejects(
        () => domstack.build(),
        error => {
          const generatedError = firstGeneratedPagesError(error)

          assert.match(generatedError.message, /must not be empty|must name a file/)
          assert.match(generatedError.message, /pages file: "invalid\.pages\.js"/)
          return true
        }
      )
    })
  }
})
