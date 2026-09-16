import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stat, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { errorText, hook, setup, writeFiles } from './helpers.js'

const rawLayout = `export default ({ children }) => '<main>' + children + '</main>'
export const pageOutputs = async ({ page }) => ({ outputName: './source.txt', content: await page.readMarkdownContent() })`

test('builder renders Markdown and exports the unrendered body from its layout at a custom destination', async t => {
  const body = '# Article\n\nKeep **Markdown**, {{ vars.title }}, and [links](./other.md).\n'
  const { build, read, dest } = await setup(t, {
    'root.layout.js': rawLayout,
    'docs/page.md': '---\ntitle: Resolved title\n---\n' + body,
  })
  const result = await build()
  assert.match(await read('docs/index.html'), /<main>\s*<h1/)
  assert.match(await read('docs/index.html'), /<strong>Markdown<\/strong>/)
  assert.equal(await read('docs/source.txt'), '\n' + body)
  const record = result.pageBuildResults?.outputs.find(output => output.outputRelname === 'docs/source.txt')
  assert.ok(record, 'page output is included in the page build report')
  assert.equal(record.filepath, join(dest, 'docs/source.txt'))
  assert.equal(record.sourceRelname, 'docs/page.md')
})

test('nested hooks run outer -> inner -> companion with isolated renderer data and resolved vars', async t => {
  const { build, read } = await setup(t, {
    'global.vars.js': "export default { layout: 'inner', title: 'global' }; export const pageOutputs = () => { throw Error('global provider ran') }",
    'global.data.js': "export default { outer: 'O', inner: 'I', selected: 'P', secret: 'hidden' }",
    'root.layout.js': `import assert from 'node:assert/strict'
      export const vars = { dataDeps: ['outer'] }
      export default ({ children, data }) => data.outer + children
      export const pageOutputs = ({ page, vars, data }) => {
        assert.equal(vars.title, 'page title')
        assert.throws(() => data.selected, /undeclared/)
        assert.equal('renderFullPage' in page, false)
        assert.equal('data' in page, false)
        globalThis[page.pageFile.filepath] = ['outer']
        return { outputName: 'outer.txt', content: data.outer }
      }`,
    'inner.layout.js': `import assert from 'node:assert/strict'
      import { readFile } from 'node:fs/promises'
      import { dirname, join } from 'node:path'
      export const parentLayout = 'root'
      export const vars = { dataDeps: ['inner'] }
      export default ({ children, data }) => data.inner + children
      export async function* pageOutputs ({ page, data }) {
        assert.throws(() => data.outer, /undeclared/)
        assert.equal(await readFile(join(dirname(page.pageFile.filepath), '../../custom-output/docs/outer.txt'), 'utf8'), 'O')
        globalThis[page.pageFile.filepath].push('inner')
        yield { outputName: './inner.txt', content: data.inner }
      }`,
    'docs/page.md': '---\ntitle: page title\n---\n# Body\n',
    'docs/page.vars.js': `import assert from 'node:assert/strict'
      import { readFile } from 'node:fs/promises'
      import { dirname, join } from 'node:path'
      export default { dataDeps: ['selected'] }
      export const pageOutputs = async ({ page, vars, data }) => {
        assert.throws(() => data.secret, /undeclared/)
        assert.throws(() => data.inner, /undeclared/)
        assert.equal(Object.isFrozen(page), true)
        assert.equal(Object.isFrozen(vars), true)
        const outputDir = join(dirname(page.pageFile.filepath), '../../custom-output/docs')
        assert.equal(await readFile(join(outputDir, 'outer.txt'), 'utf8'), 'O')
        assert.equal(await readFile(join(outputDir, 'inner.txt'), 'utf8'), 'I')
        const order = globalThis[page.pageFile.filepath]
        delete globalThis[page.pageFile.filepath]
        return [
          { outputName: '/metadata.json', content: JSON.stringify({ title: vars.title, selected: data.selected, order: [...order, 'page'] }) },
          { outputName: '../source/article.txt', content: await page.readMarkdownContent() },
        ]
      }`,
  })
  await build()
  assert.deepEqual(JSON.parse(await read('metadata.json')), { title: 'page title', selected: 'P', order: ['outer', 'inner', 'page'] })
  assert.equal(await read('docs/outer.txt'), 'O')
  assert.equal(await read('docs/inner.txt'), 'I')
  assert.equal(await read('source/article.txt'), '\n# Body\n')
  assert.match(await read('docs/index.html'), /^OI\s*<h1/)
})

for (const extension of ['html', 'js', 'ts']) {
  test(`builder supports ${extension} page companion hooks and page renderer subscriptions`, async t => {
    const { build, read } = await setup(t, {
      'global.data.js': "export default { selected: 'subscribed', secret: 'private' }",
      [`article/page.${extension}`]: extension === 'html' ? '<p>{{ vars.title }}</p>' : 'export default ({ vars, data }) => vars.title + data.selected',
      'article/page.vars.js': `import assert from 'node:assert/strict'
        export default { title: 'Companion', dataDeps: ['selected'] }
        export async function pageOutputs ({ page, vars, data }) {
          await assert.rejects(page.readMarkdownContent())
          assert.throws(() => data.secret, /undeclared/)
          return { outputName: 'metadata.json', content: JSON.stringify({ title: vars.title, value: data.selected }) }
        }`,
    })
    await build()
    assert.match(await read('article/index.html'), /Companion/)
    assert.deepEqual(JSON.parse(await read('article/metadata.json')), { title: 'Companion', value: 'subscribed' })
  })
}

test('JS page modules support promised async iterables, arrays, and empty results', async t => {
  const { build, read } = await setup(t, {
    'page.js': `export default () => 'main'; export const pageOutputs = async () => (async function* () {
      yield { outputName: 'one.txt', content: 'one' }; yield { outputName: './two.txt', content: 'two' }
    })()`,
    'array/page.js': "export default () => 'array'; export const pageOutputs = () => [{ outputName: 'array.txt', content: 'array' }]",
    'empty/page.js': "export default () => 'empty'; export const pageOutputs = () => []",
    'iterator/page.js': "export default () => 'empty iterator'; export async function* pageOutputs () {}",
  })
  await build()
  for (const name of ['one', 'two']) assert.equal(await read(`${name}.txt`), name)
  assert.equal(await read('array/array.txt'), 'array')
  assert.equal(await read('empty/index.html'), 'empty')
  assert.equal(await read('iterator/index.html'), 'empty iterator')
})

test('async generators publish each record before requesting the next at a custom destination', async t => {
  const { build, dest, read, mtime } = await setup(t, {
    'page.js': `import assert from 'node:assert/strict'
      import { readFile, stat } from 'node:fs/promises'
      import { dirname, join } from 'node:path'
      export default () => 'main'
      export async function* pageOutputs ({ page }) {
        const dest = join(dirname(page.pageFile.filepath), '../custom-output')
        yield { outputName: 'replaced.txt', content: 'replacement' }
        assert.equal(await readFile(join(dest, 'replaced.txt'), 'utf8'), 'replacement')
        yield { outputName: 'nested/new.txt', content: 'new sidecar' }
        assert.equal(await readFile(join(dest, 'nested/new.txt'), 'utf8'), 'new sidecar')
        const unchangedTime = (await stat(join(dest, 'unchanged.txt'))).mtimeMs
        yield { outputName: 'unchanged.txt', content: 'same bytes' }
        assert.equal(await readFile(join(dest, 'unchanged.txt'), 'utf8'), 'same bytes')
        assert.notEqual((await stat(join(dest, 'unchanged.txt'))).mtimeMs, unchangedTime, 'a cold build writes even identical bytes')
      }`,
  })
  await writeFiles(dest, { 'replaced.txt': 'old sidecar', 'unchanged.txt': 'same bytes' })
  await utimes(join(dest, 'unchanged.txt'), 1, 1)
  const unchangedTime = await mtime('unchanged.txt')
  const result = await build()
  assert.equal(await read('replaced.txt'), 'replacement')
  assert.equal(await read('nested/new.txt'), 'new sidecar')
  assert.notEqual(await mtime('unchanged.txt'), unchangedTime)
  assert.equal(await read('index.html'), 'main')
  for (const outputRelname of ['replaced.txt', 'nested/new.txt', 'unchanged.txt']) {
    assert.ok(result.pageBuildResults?.outputs.some(output => output.outputRelname === outputRelname), `${outputRelname} is reported, including unchanged content`)
  }
})

test('JS page outputs take precedence over companion outputs while layouts remain additive', async t => {
  const { build, read, src } = await setup(t, {
    'root.layout.js': 'export default ({ children }) => children; ' + hook('layout.txt', 'layout'),
    'page.js': "export default () => 'main'; " + hook('page.txt', 'page'),
    'page.vars.js': "export default {}; export const pageOutputs = () => { throw Error('ignored companion must not run') }",
  })
  const result = await build()
  const warnings = result.pageBuildResults?.warnings.filter(warning => 'code' in warning && warning.code === 'DOM_STACK_WARNING_DUPLICATE_PAGE_OUTPUTS_PROVIDER')
  assert.equal(warnings?.length, 1)
  const warning = warnings?.[0]
  assert.ok(warning && 'message' in warning)
  assert.ok(warning.message.includes(join(src, 'page.js')))
  assert.ok(warning.message.includes(join(src, 'page.vars.js')))
  assert.ok(result.warnings.includes(warning), 'worker warnings propagate to the aggregate build result')
  assert.equal(await read('index.html'), 'main')
  assert.equal(await read('layout.txt'), 'layout')
  assert.equal(await read('page.txt'), 'page')
})

for (const scenario of [
  { name: 'own HTML', output: 'index.html', files: {} },
  { name: 'other page HTML', output: 'other/index.html', files: { 'other/page.html': 'Other' } },
  { name: 'template', output: 'shared.txt', files: { 'shared.txt.template.js': "export default () => 'template'" } },
  { name: 'asset', output: 'shared.txt', files: { 'shared.txt': 'asset' } },
  { name: 'bundle', output: 'client.js', files: { 'client.js': 'console.log(1)', 'esbuild.settings.js': "export default opts => ({ ...opts, entryNames: '[dir]/[name]' })" } },
  { name: 'layout hook', output: 'shared.txt', files: { 'root.layout.js': 'export default ({ children }) => children; ' + hook('shared.txt') } },
  { name: 'other page hook', output: 'shared.txt', files: { 'other/page.js': "export default () => 'other'; " + hook('/shared.txt') } },
]) {
  test(`builder warns about a duplicate sidecar destination with ${scenario.name}`, async t => {
    const { build } = await setup(t, {
      'page.js': "export default () => 'new main'; " + hook(scenario.output),
      ...scenario.files,
    })
    const result = await build()
    assert.ok(result.warnings.some(warning => {
      const message = errorText(warning)
      return /duplicate|conflict/i.test(message) && message.includes(scenario.output)
    }), `expected a duplicate destination warning for ${scenario.output}: ${errorText(result.warnings)}`)
  })
}

for (const result of [
  "'bare string'",
  "{ outputName: 'bad.txt', content: 42 }",

  "{ outputName: '../escape.txt', content: 'bad' }",
  "{ outputName: '/', content: 'bad' }",
]) {
  test(`builder rejects invalid page output: ${result}`, async t => {
    const { build, dest, read } = await setup(t, {
      'page.js': `export default () => 'new'; export const pageOutputs = () => (${result})`,
    })
    await writeFiles(dest, { 'index.html': 'old' })
    await assert.rejects(build())
    assert.equal(await read('index.html'), 'old')
    await assert.rejects(stat(join(dest, '../escape.txt')), { code: 'ENOENT' })
  })
}

test('iterator failure retains earlier sidecar writes and the previous HTML', async t => {
  const { build, dest, read } = await setup(t, {
    'a/page.js': "export default () => 'new sibling'; " + hook('sibling.txt', 'new sibling sidecar'),
    'z/page.js': `export default () => 'new main'; export async function* pageOutputs () {
      yield { outputName: 'old.txt', content: 'replacement' }
      yield { outputName: 'partial.txt', content: 'published before failure' }
      throw Error('iterator exploded')
    }`,
  })
  const previous = { 'z/index.html': 'old main', 'z/old.txt': 'old sidecar', 'z/stale.txt': 'retain on failure' }
  await writeFiles(dest, previous)
  await assert.rejects(build(), error => {
    assert.match(errorText(error), /iterator exploded/)
    return true
  })
  assert.equal(await read('z/index.html'), 'old main')
  assert.equal(await read('z/old.txt'), 'replacement')
  assert.equal(await read('z/partial.txt'), 'published before failure')
  assert.equal(await read('z/stale.txt'), 'retain on failure')
})

for (const provider of ['layout', 'page']) {
  test(`a later ${provider} provider failure retains earlier layout files`, async t => {
    const failingHook = 'export const pageOutputs = () => { throw Error(\'later provider exploded\') }'
    const { build, dest, read } = await setup(t, {
      'global.vars.js': "export default { layout: 'inner' }",
      'root.layout.js': `export default ({ children }) => children
        export async function* pageOutputs () {
          yield { outputName: 'old.txt', content: 'replacement' }
          yield { outputName: 'partial.txt', content: 'partial' }
        }`,
      'inner.layout.js': `export const parentLayout = 'root'; export default ({ children }) => children;
        ${provider === 'layout' ? failingHook : 'export const pageOutputs = () => []'}`,
      'page.js': `export default () => 'new main';
        ${provider === 'page' ? failingHook : "export const pageOutputs = () => { throw Error('page provider must not run') }"}`,
    })
    await writeFiles(dest, { 'index.html': 'old main', 'old.txt': 'old sidecar' })
    await assert.rejects(build(), error => {
      assert.match(errorText(error), /later provider exploded/)
      assert.doesNotMatch(errorText(error), /page provider must not run/)
      return true
    })
    assert.equal(await read('index.html'), 'old main')
    assert.equal(await read('old.txt'), 'replacement')
    assert.equal(await read('partial.txt'), 'partial')
  })
}

for (const invalid of [
  { record: "{ outputName: '../escape.txt', content: 'invalid' }", message: /escapes dest/ },
  { record: "{ outputName: 'invalid.txt', content: 42 }", message: /content.*string/i },
]) {
  test(`a later invalid record stops the stream without requesting following yields: ${invalid.record}`, async t => {
    const { build, dest, read } = await setup(t, {
      'page.js': `import { writeFile } from 'node:fs/promises'
        import { dirname, join } from 'node:path'
        export default () => 'new main'
        export async function* pageOutputs ({ page }) {
          yield { outputName: 'first.txt', content: 'published' }
          yield ${invalid.record}
          await writeFile(join(dirname(page.pageFile.filepath), '../following-yield-requested'), 'requested')
          yield { outputName: 'following.txt', content: 'must not publish' }
        }`,
    })
    await writeFiles(dest, { 'index.html': 'old main' })
    await assert.rejects(build(), error => {
      assert.match(errorText(error), invalid.message)
      return true
    })
    assert.equal(await read('first.txt'), 'published')
    assert.equal(await read('index.html'), 'old main')
    for (const name of ['../escape.txt', 'invalid.txt', '../following-yield-requested', 'following.txt']) {
      await assert.rejects(stat(join(dest, name)), { code: 'ENOENT' })
    }
  })
}

test('identical duplicate records from one hook warn rather than reject the build', async t => {
  const { build, read } = await setup(t, {
    'page.js': `export default () => 'main'; export const pageOutputs = () => [
      { outputName: 'same.txt', content: 'same' },
      { outputName: './same.txt', content: 'same' },
    ]`,
  })
  const result = await build()
  assert.equal(await read('index.html'), 'main')
  assert.equal(await read('same.txt'), 'same')
  assert.ok(result.warnings.some(warning => {
    const message = errorText(warning)
    return /duplicate|conflict/i.test(message) && message.includes('same.txt')
  }), `expected a duplicate destination warning: ${errorText(result.warnings)}`)
})

test('render failure leaves the owning page HTML and sidecars unchanged', async t => {
  const { build, dest, read } = await setup(t, {
    'page.js': "export default () => { throw Error('render exploded') }; " + hook('old.txt', 'replacement'),
  })
  await writeFiles(dest, { 'index.html': 'old main', 'old.txt': 'old sidecar' })
  await assert.rejects(build(), error => {
    assert.match(errorText(error), /render exploded/)
    return true
  })
  assert.equal(await read('index.html'), 'old main')
  assert.equal(await read('old.txt'), 'old sidecar')
})
