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
    description: 'Build once or wait for pending work in the matching watcher (the default command).',
    example: 'domstack build --src website --dest public',
    options: {
      ...buildOptions,
      'replace-watch': { type: 'boolean', help: 'stop the matching watcher, empty its destination, then build once' },
      ...commonOptions,
    },
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
      port: {
        type: 'string',
        help: 'preferred site port, between 1 and 65535 (default: 3000)',
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
  sessions: {
    description: 'List local DOMStack watch sessions or inspect one by ID.',
    example: 'domstack sessions --json',
    options: {
      json: { type: 'boolean', help: 'output JSON for automation' },
      ...commonOptions,
    },
  },
  eject: {
    description: 'Extract the default layout, styles, and client, and add their dependencies.\nWarning: overwrites the target files.',
    example: 'domstack eject --language ts --src src',
    options: {
      ...sourceOptions,
      /** Source language: 'js' | 'ts'. Both outputs are ready to use without compilation. */
      language: {
        type: 'string',
        default: 'js',
        help: 'source language: js (JavaScript) or ts (TypeScript)',
      },
      /** CSS preset: 'mine' | 'tailwind' | 'none'. */
      css: {
        type: 'string',
        default: 'mine',
        help: 'global CSS preset: mine (default, mine.css and syntax themes), tailwind (Tailwind CSS and esbuild plugin), or none (no global styles)',
      },

      /** Browser JSX runtime: 'none' | 'preact' | 'react'. Does not generate example components. */
      framework: {
        type: 'string',
        default: 'none',
        help: 'browser JSX runtime: none (no integration), preact, or react; adds runtime dependencies and automatic JSX settings',
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
