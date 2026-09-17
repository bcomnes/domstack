import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { DomStackDataError } from '../../helpers/domstack-error.js'
import { setup, errorText } from '../outputs/test-helpers.js'

for (const provider of ['page', 'companion', 'layout']) {
  for (const scenario of [
    { name: 'synchronous', declaration: 'function', body: "return { outputName: 'secret.txt', content: data.secret }" },
    { name: 'asynchronous', declaration: 'async function', body: "await Promise.resolve(); return { outputName: 'secret.txt', content: data.secret }" },
    { name: 'iterator', declaration: 'async function*', body: "yield { outputName: 'first.txt', content: 'written' }; yield { outputName: 'secret.txt', content: data.secret }" },
  ]) {
    test(`subscription errors survive worker transport from ${scenario.name} ${provider} pageOutputs`, async t => {
      const providerFile = provider === 'layout' ? 'root.layout.js' : provider === 'companion' ? 'page.vars.js' : 'page.js'
      const render = provider === 'layout' ? 'export default ({ children }) => children' : provider === 'companion' ? 'export default {}' : "export default () => 'main'"
      const { build, src, read } = await setup(t, {
        'global.data.js': "export default { secret: 'private' }",
        'page.js': "export default () => 'main'",
        [providerFile]: `${render}; export ${scenario.declaration} pageOutputs ({ data }) { ${scenario.body} }`,
      })
      await assert.rejects(build(), error => {
        assert.ok(error instanceof AggregateError)
        const dataError = error.errors.find(err => err instanceof DomStackDataError)
        assert.ok(dataError, 'a DomStackDataError survives worker transport')
        assert.equal(dataError.name, 'DomStackDataError')
        assert.equal(dataError.code, 'DOM_STACK_ERROR_DATA')
        assert.deepEqual(dataError.dataDependency, {
          reason: 'UNDECLARED_KEY',
          consumer: provider === 'layout' ? 'Layout "root"' : 'Page "page.js"',
          key: 'secret',
        })
        assert.ok(dataError.message.includes(`pageOutputs for page "page.js" from ${provider} "${join(src, providerFile)}"`))
        assert.ok(dataError.cause instanceof Error)
        assert.match(errorText(dataError.cause), /undeclared global data key "secret"/)
        return true
      })
      if (scenario.name === 'iterator') assert.equal(await read('first.txt'), 'written')
    })
  }
}
