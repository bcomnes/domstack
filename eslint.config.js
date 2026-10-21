import { globalIgnores } from 'eslint/config'
import { neostandard, resolveIgnoresFromGitignore } from 'neostandard'

export default [
  globalIgnores([
    ...resolveIgnoresFromGitignore(),
    'lib/defaults/default.root.layout.js',
    'test-cases/build-errors/src/**/*.js',
    'test-cases/page-build-errors/src/**/*.js',
  ]),
  ...neostandard({
    env: ['browser'],
    ts: true,
  }),
]
