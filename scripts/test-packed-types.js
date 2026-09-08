import { execFile, spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const projectPath = path.resolve(import.meta.dirname, '..')
const { dependencies, devDependencies } = JSON.parse(await readFile(path.join(projectPath, 'package.json'), 'utf8'))
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
        pino: dependencies.pino,
        typescript: devDependencies.typescript,
      },
    }, null, 2)}\n`),
    writeFile(path.join(consumerPath, 'index.ts'), `import { DomStack, PageData } from '@domstack/static'
import pino from 'pino'

const stack = new DomStack('src', 'public', { logger: pino({ level: 'silent' }) })
void PageData
void stack
`),
    writeFile(path.join(consumerPath, 'types.ts'), `import pino from 'pino'
import type { WorkerOptions } from 'node:worker_threads'
import type {
  DomStackOpts,
  PageFunction,
  Results,
} from '@domstack/static/types.js'

const logger = pino({ level: 'silent' })
const options: DomStackOpts = { buildDrafts: true, logger }
const render: PageFunction<Record<string, unknown>, string> = ({ vars }) => String(vars)

// The logger option retains Pino's full contract.
const configuredLogger: pino.Logger | undefined = options.logger
const childOptions: DomStackOpts = { logger: logger.child({ component: 'consumer' }) }
// @ts-expect-error A generic logging object is not a Pino logger.
const invalidOptions: DomStackOpts = { logger: { info () {} } }

// The compatibility alias preserves the transport's transfer-list type, not any.
type TransferItem = NonNullable<Parameters<ReturnType<typeof pino.transport>['emit']>[2]>[number]
declare const item: TransferItem
const expected: NonNullable<WorkerOptions['transferList']>[number] = item
const actual: TransferItem = expected
// @ts-expect-error A primitive is not transferable.
const invalidTransfer: TransferItem = 123

void render
void configuredLogger
void childOptions
void invalidOptions
void actual
void invalidTransfer
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
    writeFile(path.join(consumerPath, 'tsconfig-types.json'), `${JSON.stringify({
      extends: './tsconfig.json',
      include: ['types.ts'],
    }, null, 2)}\n`),
  ])

  await run(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock'],
    consumerPath
  )
  // Node 26 exercises the missing alias; 24 and 22 guard against duplicate
  // declarations on supported older releases. Check each entry in isolation.
  for (const nodeVersion of [26, 24, 22]) {
    if (nodeVersion !== 26) {
      await run(
        'npm',
        ['install', `@types/node@^${nodeVersion}.0.0`, '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock'],
        consumerPath
      )
    }
    for (const config of ['tsconfig.json', 'tsconfig-types.json']) {
      console.log(`Checking TypeScript ${devDependencies.typescript}, @types/node ${nodeVersion}, ${config}`)
      await run(
        process.execPath,
        [path.join(consumerPath, 'node_modules', 'typescript', 'bin', 'tsc'), '--project', config],
        consumerPath
      )
    }
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
