#!/usr/bin/env node

/**
 * @import { BuildStepWarnings, DomStackOpts as DomStackOpts } from './lib/builder.js'
 * @import { ArgscloptsParseArgsOptionsConfig } from 'argsclopts'
 * @import { Logger as PinoLogger } from 'pino'
 * @import { BsInstance } from '@domstack/sync'
 */

import { readFile } from 'node:fs/promises'
import { basename, resolve, join, relative } from 'node:path'
import { parseArgs } from 'node:util'
import { printHelpText } from 'argsclopts'
import readline from 'node:readline'
import process from 'process'
// @ts-expect-error
import tree from 'pretty-tree'
import { inspect } from 'util'
import { createServer } from '@domstack/sync'
import { packageDirectory } from 'package-directory'
import { readPackage } from 'read-pkg'
import { addPackageDependencies } from 'write-package'

import { copyFile } from './lib/helpers/copy-file.js'
import { DomStack } from './index.js'
import { DomStackAggregateError } from './lib/helpers/domstack-aggregate-error.js'
import { generateTreeData } from './lib/helpers/generate-tree-data.js'
import { askYesNo } from './lib/helpers/cli-prompt.js'
import { createDomStackLogger } from './lib/logger.js'

const __dirname = import.meta.dirname

async function getPkg () {
  const pkgPath = resolve(__dirname, './package.json')
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
  return pkg
}

/** @type {ArgscloptsParseArgsOptionsConfig} */
const options = {
  src: {
    type: 'string',
    short: 's',
    default: 'src',
    help: 'path to source directory',
  },
  dest: {
    type: 'string',
    short: 'd',
    default: 'public',
    help: 'path to build destination directory',
  },
  ignore: {
    type: 'string',
    short: 'i',
    help: 'comma separated gitignore style ignore string',
  },
  drafts: {
    type: 'boolean',
    help: 'Build draft pages with the `.draft.{md,js,html}` page suffix.',
    default: false
  },
  noEsbuildMeta: {
    type: 'boolean',
    help: 'skip writing the esbuild metafile to disk',
  },
  customDomstackManifestName: {
    type: 'string',
    help: 'custom domstack manifest filename (default: domstack-manifest.json)',
  },
  noDomstackManifest: {
    type: 'boolean',
    help: 'disable writing the domstack manifest to disk',
  },
  eject: {
    type: 'boolean',
    short: 'e',
    help: 'eject the DOMStack default layout, style and client into the src flag directory',
  },
  watch: {
    type: 'boolean',
    short: 'w',
    help: 'build, watch and serve the site build',
  },
  'watch-only': {
    type: 'boolean',
    help: 'watch and build the src folder without serving',
  },
  serve: {
    type: 'boolean',
    help: 'build once and serve the destination directory without watching',
  },
  port: {
    type: 'string',
    help: 'port for --serve (default: 3000)',
  },
  copy: {
    type: 'string',
    help: 'path to directories to copy into dist; can be used multiple times',
    multiple: true
  },
  help: {
    type: 'boolean',
    short: 'h',
    help: 'show help',
  },
  version: {
    type: 'boolean',
    short: 'v',
    help: 'show version information',
  },
}

const { values: argv } = parseArgs({ options })

async function run () {
  if (argv['version']) {
    const pkg = await getPkg()
    console.log(pkg.version)
    process.exit(0)
  }

  if (argv['help']) {
    const pkg = await getPkg()
    await printHelpText({
      options,
      name: pkg.name,
      version: pkg.version,
      exampleFn: ({ name }) => '    ' + `Example: ${name} --src website --dest public\n`,
    })

    process.exit(0)
  }
  const cwd = process.cwd()
  const srcFlag = String(argv['src'])
  const destFlag = String(argv['dest'])
  if (!srcFlag) throw new Error('The src flag is required')
  if (!destFlag) throw new Error('The dest flag is required')

  const src = resolve(join(cwd, srcFlag))
  const dest = resolve(join(cwd, destFlag))

  // Eject task
  if (argv['eject']) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    const localPkg = await packageDirectory({ cwd: src })

    if (!localPkg) {
      console.error('Can\'t locate package.json, exiting without making changes')
      process.exit(1)
    }

    const localPkgJson = join(localPkg, 'package.json')
    const localPkgJsonContents = await readPackage({ cwd: localPkg })
    const targetIsModule = localPkgJsonContents.type === 'module'

    const relativeSrc = relative(process.cwd(), src)
    const relativePkg = relative(process.cwd(), localPkgJson)

    const targetLayoutPath = `layouts/root.layout.${targetIsModule ? 'js' : 'mjs'}`
    const targetGlobalStylePath = 'globals/global.css'
    const targetGlobalClientPath = `globals/global.client.${targetIsModule ? 'js' : 'mjs'}`

    const tbPkgContents = await readPackage({ cwd: __dirname })
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
    const answer = await askYesNo(rl, 'Continue?')
    if (answer === false) {
      console.log('No action taken. Exiting.')
      process.exit(0)
    }

    const defaultLayoutPath = join(__dirname, 'lib/defaults/default.root.layout.js')
    const defaultGlobalStylePath = join(__dirname, 'lib/defaults/default.style.css')
    const defaultGlobalClientPath = join(__dirname, 'lib/defaults/default.client.js')

    await Promise.all([
      copyFile(defaultLayoutPath, join(src, targetLayoutPath)),
      copyFile(defaultGlobalStylePath, join(src, targetGlobalStylePath)),
      copyFile(defaultGlobalClientPath, join(src, targetGlobalClientPath)),
    ])

    await addPackageDependencies(
      localPkgJson,
      {
        dependencies: {
          'mine.css': mineVersion,
          fragtml: fragtmlVersion,
          'highlight.js': highlightVersion,
        },
      })

    console.log('Done ejecting files!')
    process.exit(0)
  }

  /** @type {DomStackOpts} */
  const opts = {}

  if (argv['ignore']) opts.ignore = String(argv['ignore']).split(',')
  if (argv['noEsbuildMeta']) opts.metafile = false
  if (argv['noDomstackManifest'] && argv['customDomstackManifestName']) {
    throw new Error('--customDomstackManifestName cannot be combined with --noDomstackManifest')
  }
  if (argv['noDomstackManifest']) opts.domstackManifest = false
  if (argv['customDomstackManifestName']) {
    opts.domstackManifest = {
      ...(typeof opts.domstackManifest === 'object' ? opts.domstackManifest : {}),
      filename: String(argv['customDomstackManifestName']),
    }
  }
  if (argv['drafts']) opts.buildDrafts = true
  if (argv['copy']) {
    const copyPaths = Array.isArray(argv['copy']) ? argv['copy'] : [argv['copy']]
    // @ts-expect-error
    opts.copy = copyPaths.map(p => resolve(cwd, p))
  }

  const logger = createDomStackLogger()
  opts.logger = logger
  const domStack = new DomStack(src, dest, opts)
  /** @type {BsInstance | null} */
  let buildServer = null

  if (argv['serve'] && (argv['watch'] || argv['watch-only'])) {
    throw new Error('--serve cannot be combined with --watch or --watch-only')
  }
  if (argv['port'] && !argv['serve']) {
    throw new Error('--port can only be combined with --serve')
  }
  const servePort = argv['port'] ? parsePort(String(argv['port'])) : undefined

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

  if (!argv['watch'] && !argv['watch-only']) {
    try {
      const results = await domStack.build()
      logger.info(tree(generateTreeData(cwd, src, dest, results)))
      logWarnings(logger, results?.warnings)
      logger.info('\nBuild Success!\n\n')
      if (argv['serve']) {
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
      logger.error(inspect(err, { depth: 999, colors: true }))
      logger.error('\nBuild Failed!\n\n')
      process.exit(1)
    }
  } else {
    await domStack.watch({
      serve: !argv['watch-only'],
      onInitialBuild: (initialResults) => {
        logger.info(tree(generateTreeData(cwd, src, dest, initialResults)))
        logWarnings(logger, initialResults?.warnings)
      },
    })
  }
}

/**
 * @param {string} value
 */
function parsePort (value) {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('--port must be an integer between 1 and 65535')
  }
  return port
}

/**
 * @param {PinoLogger} logger
 * @param {BuildStepWarnings | undefined} warnings
 */
function logWarnings (logger, warnings) {
  if ((warnings?.length ?? 0) === 0) return

  logger.warn('\nThere were build warnings:\n')
  for (const warning of warnings ?? []) {
    if ('message' in warning) {
      logger.warn(`  ${warning.message}`)
    } else {
      logger.warn(inspect(warning, { depth: 999, colors: true }))
    }
  }
}

run().catch(err => {
  console.error(new Error('Unhandled domstack error', { cause: err }))
  process.exit(1)
})
