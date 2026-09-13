import assert from 'node:assert/strict'
import { inspect } from 'node:util'
import test from 'node:test'
import { serializeEsbuildError } from './index.js'

const diagnostic = {
  id: '',
  pluginName: '',
  text: 'Could not resolve "./missing.css"',
  location: {
    column: 8,
    file: 'src/style.css',
    length: 15,
    line: 1,
    lineText: '@import "./missing.css";',
    namespace: 'file',
    suggestion: '',
  },
  notes: [],
  detail: undefined,
}

test('serializeEsbuildError preserves nested aggregate failures and metadata', () => {
  const failure = Object.assign(new Error('Build failed'), { errors: [diagnostic], warnings: [] })
  const cause = new Error('original cause')
  const aggregate = new AggregateError([new AggregateError([failure], 'nested'), new Error('cleanup'), 'non-error'], 'multiple failures', { cause })
  const serialized = serializeEsbuildError(aggregate)
  assert.ok(serialized instanceof AggregateError)
  assert.equal(serialized.message, aggregate.message)
  assert.equal(serialized.stack, aggregate.stack)
  assert.equal(serialized.cause, cause)
  assert.ok(serialized.errors[0] instanceof AggregateError)
  assert.deepEqual(serialized.errors[0].errors[0].errors, [diagnostic])
  assert.equal(serialized.errors[1], aggregate.errors[1])
  assert.equal(serialized.errors[2].message, 'non-error')
  assert.deepEqual(JSON.parse(JSON.stringify(serialized)).errors[0].errors[0].errors, [JSON.parse(JSON.stringify(diagnostic))])
})

test('serializeEsbuildError materializes diagnostic accessors as plain arrays', () => {
  const failure = new Error('Build failed with 1 error')
  Object.defineProperties(failure, {
    errors: { get: () => [diagnostic], set: () => {}, enumerable: true },
    warnings: { get: () => [], set: () => {}, enumerable: true },
  })

  const serialized = serializeEsbuildError(failure)
  const errorsDescriptor = Object.getOwnPropertyDescriptor(serialized, 'errors')
  const warningsDescriptor = Object.getOwnPropertyDescriptor(serialized, 'warnings')

  assert.deepEqual(errorsDescriptor?.value, [diagnostic])
  assert.deepEqual(warningsDescriptor?.value, [])
  assert.equal(errorsDescriptor?.get, undefined)
  assert.equal(warningsDescriptor?.get, undefined)
  assert.doesNotMatch(inspect(serialized), /Getter\/Setter/)
  assert.match(inspect(serialized), /Could not resolve/)
})
