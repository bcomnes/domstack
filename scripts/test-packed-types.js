import { execFile, spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const projectPath = path.resolve(import.meta.dirname, '..')
const temporaryPath = await mkdtemp(path.join(tmpdir(), 'domstack-packed-types-'))
const consumerPath = path.join(temporaryPath, 'consumer')

try {
  await Promise.all([
    run('npm', ['run', 'clean:declarations-top'], projectPath),
    run('npm', ['run', 'clean:declarations-lib'], projectPath),
  ])
  await run('npm', ['run', 'build:declaration'], projectPath)
  const { stdout } = await execFileAsync(
    'npm',
    ['pack', '--json', '--ignore-scripts', '--pack-destination', temporaryPath],
    { cwd: projectPath, encoding: 'utf8' }
  )
  const [{ filename }] = JSON.parse(stdout)
  const tarballPath = path.join(temporaryPath, filename)

  await mkdir(consumerPath)
  await Promise.all([
    writeFile(path.join(consumerPath, 'package.json'), `${JSON.stringify({
      name: 'domstack-packed-type-consumer',
      private: true,
      type: 'module',
      dependencies: {
        '@domstack/static': `file:${tarballPath}`,
        '@types/node': '^26.0.1',
        'typescript-5': 'npm:typescript@~5.9.0',
        'typescript-6': 'npm:typescript@~6.0.0',
      },
    }, null, 2)}\n`),
    writeFile(path.join(consumerPath, 'index.ts'), `import { DomStack, PageData } from '@domstack/static'
import type {
  DomStackLogger,
  DomStackOpts,
  PageFunction,
  Results,
} from '@domstack/static/types.js'

const logger: DomStackLogger = {
  trace () {},
  debug () {},
  info () {},
  warn () {},
  error () {},
  fatal () {},
  child () { return logger },
}
const options: DomStackOpts = { buildDrafts: true, logger }
const render: PageFunction<Record<string, unknown>, string> = ({ vars }) => String(vars)
const stack = new DomStack('src', 'public', options)

void PageData
void render
void stack
void ({} as Results)
`),
    writeFile(path.join(consumerPath, 'tsconfig.json'), `${JSON.stringify({
      compilerOptions: {
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        noEmit: true,
        skipLibCheck: false,
        strict: true,
        target: 'ES2022',
        types: ['node'],
      },
      include: ['index.ts'],
    }, null, 2)}\n`),
  ])

  await run(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock'],
    consumerPath
  )
  for (const version of ['typescript-5', 'typescript-6']) {
    await run(
      process.execPath,
      [path.join(consumerPath, 'node_modules', version, 'bin', 'tsc')],
      consumerPath
    )
  }
} finally {
  await rm(temporaryPath, { recursive: true, force: true })
  await Promise.all([
    run('npm', ['run', 'clean:declarations-top'], projectPath),
    run('npm', ['run', 'clean:declarations-lib'], projectPath),
  ])
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {string} cwd
 * @returns {Promise<void>}
 */
function run (command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${command} exited with ${signal ?? code}`))
      }
    })
  })
}
