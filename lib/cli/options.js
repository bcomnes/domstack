/**
 * @import { ArgscloptsParseArgsOptionsConfig } from 'argsclopts'
 * @typedef {{ description: string, example: string, options: ArgscloptsParseArgsOptionsConfig }} CommandDefinition
 */

/** @satisfies {ArgscloptsParseArgsOptionsConfig} */
const commonOptions = {
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

/** @satisfies {ArgscloptsParseArgsOptionsConfig} */
const sourceOptions = {
  src: {
    type: 'string',
    short: 's',
    default: 'src',
    help: 'path to source directory',
  },
}

/** @satisfies {ArgscloptsParseArgsOptionsConfig} */
const buildOptions = {
  ...sourceOptions,
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
    default: false,
    help: 'build draft pages with the `.draft.{md,js,ts,html}` page suffix',
  },
  noEsbuildMeta: {
    type: 'boolean',
    help: 'skip writing the esbuild metafile to disk',
  },
  domstackManifest: {
    type: 'boolean',
    help: 'write the domstack manifest to disk',
  },
  copy: {
    type: 'string',
    multiple: true,
    help: 'path to directories to copy into the destination; can be used multiple times',
  },
  verbose: {
    type: 'boolean',
    help: 'show debug logs, including individual copy operations',
  },
}

/** @satisfies {Record<string, CommandDefinition>} */
export const commands = {
  build: {
    description: 'Build the site once (the default command).',
    example: 'domstack build --src website --dest public',
    options: { ...buildOptions, ...commonOptions },
  },
  watch: {
    description: 'Build, watch, and serve the site with live reload.',
    example: 'domstack watch --src website --no-serve',
    options: {
      ...buildOptions,
      'no-serve': {
        type: 'boolean',
        help: 'watch and build without serving',
      },
      ...commonOptions,
    },
  },
  serve: {
    description: 'Build once, then serve without watching or live reload.',
    example: 'domstack serve --port 8080',
    options: {
      ...buildOptions,
      port: {
        type: 'string',
        help: 'server port, between 1 and 65535 (default: 3000)',
      },
      ...commonOptions,
    },
  },
  eject: {
    description: 'Extract the default layout, styles, and client, and add their dependencies.\nWarning: overwrites the target files.',
    example: 'domstack eject --language ts --src src',
    options: {
      ...sourceOptions,
      language: {
        type: 'string',
        default: 'js',
        help: 'language for ejected files: js or ts',
      },
      yes: {
        type: 'boolean',
        help: 'skip confirmation before ejecting',
      },
      ...commonOptions,
    },
  },
}

/** @typedef {keyof typeof commands} CommandName */

/** @satisfies {ArgscloptsParseArgsOptionsConfig} */
export const legacyOptions = {
  eject: { type: 'boolean', short: 'e', help: 'alias for domstack eject' },
  watch: { type: 'boolean', short: 'w', help: 'alias for domstack watch' },
  'watch-only': { type: 'boolean', help: 'alias for domstack watch --no-serve' },
  serve: { type: 'boolean', help: 'alias for domstack serve' },
}

/** @param {string} name
 * @returns {name is CommandName}
 */
export function isCommand (name) {
  return Object.hasOwn(commands, name)
}
