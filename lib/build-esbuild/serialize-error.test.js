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
