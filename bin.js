#!/usr/bin/env node

/**
 * @import { BuildStepWarnings, DomStackOpts as DomStackOpts, Results } from './lib/builder.js'

 * @import { Logger as PinoLogger } from 'pino'
 * @import { BsInstance } from '@domstack/sync'
 */

import { readFile } from 'node:fs/promises'
import { basename, resolve, relative } from 'node:path'

import process from 'process'
import tree from 'pretty-tree'
import { inspect } from 'util'
import { createServer, parseOptions as parseSyncOptions } from '@domstack/sync'

import { DomStack } from './index.js'
import { DestinationConflictError } from './lib/destination-claim.js'
import { DomStackAggregateError } from './lib/helpers/domstack-aggregate-error.js'
import { generateTreeData } from './lib/helpers/generate-tree-data.js'

import { createDomStackLogger } from './lib/logger.js'
import { CliUsageError, parseCliArgs } from './lib/cli/args.js'
import { formatCliHelp } from './lib/cli/help.js'
import { eject } from './lib/cli/eject.js'
import { showWatchSessions } from './lib/cli/sessions.js'
import { delegateWatchBuild } from './lib/cli/watch-build.js'
import { WatchControlError } from './lib/watch/control.js'

const __dirname = import.meta.dirname

/** @param {string} [pkgPath] */
async function getPkg (pkgPath = resolve(__dirname, './package.json')) {
  const source = await readFile(pkgPath, 'utf8')
  const pkg = JSON.parse(source.replace(/^\uFEFF/, ''))
  return pkg
}

async function run () {
  const { command, values: argv, helpCommand, sessionId } = parseCliArgs(process.argv.slice(2))
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
  if (command === 'sessions') return showWatchSessions(sessionId, Boolean(argv['json']))

  const cwd = process.cwd()
  const src = resolve(cwd, String(argv['src']))

  if (command === 'eject') {
    await eject({
      src,
      yes: Boolean(argv['yes']),
      language: /** @type {'js' | 'ts'} */ (argv['language']),
      framework: /** @type {'none' | 'preact' | 'react'} */ (argv['framework']),
      css: /** @type {'mine' | 'tailwind' | 'none'} */ (argv['css']),
    })
    process.exit(0)
  }

  const dest = resolve(cwd, String(argv['dest']))
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
  /** @type {Promise<Results> | undefined} */
  let buildWork
  let quitting = false

  const preferredPort = argv['port'] ? Number(argv['port']) : undefined

  process.once('SIGINT', quit)
  process.once('SIGTERM', quit)

  async function quit () {
    if (quitting) return
    quitting = true
    await buildWork?.catch(() => {})
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
      buildWork = domStack.build()
      const results = await buildWork
      if (quitting) return
      logger.info(tree(generateTreeData(cwd, src, dest, results)))
      logWarnings(logger, results?.warnings)
      logger.info(`Built ${relative(cwd, src) || '.'} → ${relative(cwd, dest) || '.'}`)
      logger.info('Build Success!')
      if (command === 'serve') {
        buildServer = await createServer({
          server: dest,
          files: basename(dest),
          logger: logger.child({ component: 'sync', logPrefix: '[domstack-sync]' }),
          port: preferredPort ?? parseSyncOptions().port,
          snippet: false,
        })
        logger.info(`Serving ${relative(cwd, dest)} without watching. Press Ctrl-C to stop.`)
      }
    } catch (err) {
      if (err instanceof DestinationConflictError) {
        if (command === 'build' && !quitting && await delegateWatchBuild(src, err.destination, argv)) return
        throw err
      }
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
      port: preferredPort,
      onInitialBuild: (initialResults) => {
        logger.info(tree(generateTreeData(cwd, src, dest, initialResults)))
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
  if (err instanceof DestinationConflictError || err instanceof WatchControlError) {
    console.error(`domstack: ${err.message}`)
    process.exitCode = 1
    return
  }
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
