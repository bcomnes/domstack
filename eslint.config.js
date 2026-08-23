import neostandard, { resolveIgnoresFromGitignore } from 'neostandard'

export default neostandard({
  env: ['browser'],
  ts: true,
  ignores: [
    ...resolveIgnoresFromGitignore(),
    'test-cases/build-errors/src/**/*.js',
    'test-cases/page-build-errors/src/**/*.js',
  ],
})
