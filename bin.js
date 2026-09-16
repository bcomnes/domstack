#!/usr/bin/env node

/**
 * @import { BuildStepWarnings, DomStackOpts as DomStackOpts } from './lib/builder.js'

 * @import { Logger as PinoLogger } from 'pino'
 * @import { BsInstance } from '@domstack/sync'
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, resolve, join, relative } from 'node:path'

import readline from 'node:readline'
import process from 'process'
// @ts-expect-error
import tree from 'pretty-tree'
import { inspect } from 'util'
import { createServer } from '@domstack/sync'
import { packageDirectory } from 'package-directory'

import { copyFile } from './lib/helpers/copy-file.js'
import { addPackageDependencies } from './lib/helpers/add-package-dependencies.js'
import { DomStack } from './index.js'
import { DomStackAggregateError } from './lib/helpers/domstack-aggregate-error.js'
import { generateTreeData } from './lib/helpers/generate-tree-data.js'
import { askYesNo } from './lib/helpers/cli-prompt.js'
import { createDomStackLogger } from './lib/logger.js'
import { CliUsageError, parseCliArgs } from './lib/cli/args.js'
import { formatCliHelp } from './lib/cli/help.js'

const __dirname = import.meta.dirname

/** @param {string} [pkgPath] */
async function getPkg (pkgPath = resolve(__dirname, './package.json')) {
  const source = await readFile(pkgPath, 'utf8')
  const pkg = JSON.parse(source.replace(/^\uFEFF/, ''))
  return pkg
}

async function run () {
  const { command, values: argv, helpCommand } = parseCliArgs(process.argv.slice(2))
  if (argv['version']) {
    const pkg = await getPkg()
    console.log(pkg.version)
    process.exit(0)
  }

  if (argv['help']) {
    const pkg = await getPkg()
    console.log(await formatCliHelp(helpCommand, pkg.version))

    process.exit(0)
  }
  const cwd = process.cwd()
  const src = resolve(join(cwd, String(argv['src'])))

  if (command === 'eject') {
    const language = argv['language']

    const localPkg = await packageDirectory({ cwd: src })

    if (!localPkg) {
      console.error('Can\'t locate package.json, exiting without making changes')
      process.exit(1)
    }

    const localPkgJson = join(localPkg, 'package.json')
    const localPkgJsonContents = await getPkg(localPkgJson)
    const targetIsModule = localPkgJsonContents.type === 'module'

    const relativeSrc = relative(process.cwd(), src)
    const relativePkg = relative(process.cwd(), localPkgJson)

    const extension = language === 'ts' ? (targetIsModule ? 'ts' : 'mts') : targetIsModule ? 'js' : 'mjs'
    const targetLayoutPath = `layouts/root.layout.${extension}`
    const targetGlobalStylePath = 'globals/global.css'
    const targetGlobalClientPath = `globals/global.client.${language === 'ts' ? 'ts' : extension}`

    const tbPkgContents = await getPkg()
    const mineVersion = tbPkgContents?.['dependencies']?.['mine.css']
    const fragtmlVersion = tbPkgContents?.['dependencies']?.['fragtml']
    const highlightVersion = tbPkgContents?.['dependencies']?.['highlight.js']

    if (!mineVersion || !fragtmlVersion || !highlightVersion) {
      console.error('Unable to resolve ejected dependency versions. Exiting...')
      process.exit(1)
    }

    console.log(`
domstack eject actions:
  - Write ${join(relativeSrc, targetLayoutPath)}
  - Write ${join(relativeSrc, targetGlobalStylePath)}
  - Write ${join(relativeSrc, targetGlobalClientPath)}
  - Add mine.css@${mineVersion} to ${relativePkg}
  - Add fragtml@${fragtmlVersion} to ${relativePkg}
  - Add highlight.js@${highlightVersion} to ${relativePkg}
`)
    if (!argv['yes']) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
      let answer
      try {
        answer = await askYesNo(rl, 'Continue?')
      } finally {
        rl.close()
      }
      if (!answer) {
        console.log('No action taken. Exiting.')
        process.exit(0)
      }
    }

    const defaultLayoutPath = join(__dirname, `lib/defaults/default.root.layout.${language}`)
    const defaultGlobalStylePath = join(__dirname, 'lib/defaults/default.style.css')
    const defaultGlobalClientPath = join(__dirname, 'lib/defaults/default.client.js')

    const layoutSource = await readFile(defaultLayoutPath, 'utf8')
    const layout = language === 'ts'
      ? layoutSource.replace("from '#types'", "from '@domstack/static/types.js'")
      : layoutSource
    await mkdir(join(src, 'layouts'), { recursive: true })
    await Promise.all([
      writeFile(join(src, targetLayoutPath), layout),
      copyFile(defaultGlobalStylePath, join(src, targetGlobalStylePath)),
      copyFile(defaultGlobalClientPath, join(src, targetGlobalClientPath)),
    ])

    await addPackageDependencies(
      localPkgJson,
      {
        'mine.css': mineVersion,
        fragtml: fragtmlVersion,
        'highlight.js': highlightVersion,
      })

    console.log('Done ejecting files!')
    process.exit(0)
  }

  const dest = resolve(join(cwd, String(argv['dest'])))
  /** @type {DomStackOpts} */
  const opts = {}

  if (argv['ignore']) opts.ignore = String(argv['ignore']).split(',')
  if (argv['noEsbuildMeta']) opts.metafile = false
  if (argv['domstackManifest']) opts.domstackManifest = true
  if (argv['drafts']) opts.buildDrafts = true
  if (argv['copy']) {
    const copyPaths = Array.isArray(argv['copy']) ? argv['copy'] : [argv['copy']]
    // @ts-expect-error
    opts.copy = copyPaths.map(p => resolve(cwd, p))
  }

  const logger = createDomStackLogger(argv['verbose'] ? 'debug' : 'info')
  opts.logger = logger
  const domStack = new DomStack(src, dest, opts)
  /** @type {BsInstance | null} */
  let buildServer = null

  const servePort = argv['port'] ? Number(argv['port']) : undefined

  process.once('SIGINT', quit)
  process.once('SIGTERM', quit)

  async function quit () {
    if (domStack.watching) {
      await domStack.stopWatching()
      logger.info('Watching stopped')
    }
    if (buildServer) {
      await buildServer.exit()
      buildServer = null
      logger.info('Server stopped')
    }
    logger.info('Quitting cleanly')
    process.exit(0)
  }

  if (command !== 'watch') {
    try {
      const results = await domStack.build()
      logger.debug(tree(generateTreeData(cwd, src, dest, results)))
      logWarnings(logger, results?.warnings)
      logger.info(`Built ${relative(cwd, src) || '.'} → ${relative(cwd, dest) || '.'}`)
      logger.info('Build Success!')
      if (command === 'serve') {
        buildServer = await createServer({
          server: dest,
          files: basename(dest),
          logger: logger.child({ component: 'sync', logPrefix: '[domstack-sync]' }),
          ...(servePort ? { port: servePort } : {}),
          snippet: false,
        })
        logger.info(`Serving ${relative(cwd, dest)} without watching. Press Ctrl-C to stop.`)
      }
    } catch (err) {
      if (!(err instanceof Error || err instanceof AggregateError)) throw new Error('Non-error thrown', { cause: err })
      if (err instanceof DomStackAggregateError) {
        if (err?.results?.siteData?.pages) {
          logger.error(tree(generateTreeData(cwd, src, dest, err.results)))
        }
      }
      if ('results' in err) delete err.results
      logger.error(formatDiagnostic(err, Boolean(process.stdout.isTTY)))
      logger.error('Build Failed!')
      process.exit(1)
    }
  } else {
    await domStack.watch({
      serve: !argv['no-serve'],
      onInitialBuild: (initialResults) => {
        logger.debug(tree(generateTreeData(cwd, src, dest, initialResults)))
        logWarnings(logger, initialResults?.warnings)
      },
    })
  }
}

/**
 * @param {PinoLogger} logger
 * @param {BuildStepWarnings | undefined} warnings
 */
function logWarnings (logger, warnings) {
  if ((warnings?.length ?? 0) === 0) return

  logger.warn('There were build warnings:')
  for (const warning of warnings ?? []) {
    if ('message' in warning) {
      logger.warn(`  ${warning.message}`)
    } else {
      logger.warn(formatDiagnostic(warning, Boolean(process.stdout.isTTY)))
    }
  }
}

/**
 * Keep nested causes, locations, and every diagnostic visible in CLI output.
 * @param {unknown} value
 * @param {boolean} colors
 */
function formatDiagnostic (value, colors) {
  return inspect(value, {
    depth: null,
    maxArrayLength: null,
    maxStringLength: null,
    colors,
  })
}

run().catch(err => {
  if (err instanceof CliUsageError) {
    console.error(`domstack: ${err.message}`)
    console.error(`Run "domstack${err.command ? ` ${err.command}` : ''} --help" for usage.`)
    process.exit(1)
  }
  console.error(formatDiagnostic(
    new Error('Unhandled domstack error', { cause: err }),
    Boolean(process.stderr.isTTY)
  ))
  process.exit(1)
})
