/** @import { CommandName } from './options.js' */

import { styleText } from 'node:util'
import { formatHelpText } from 'argsclopts'
import { domstackBanner } from './banner.js'
import { commands } from './options.js'

/**
 * @param {CommandName | null} command
 * @param {string} version
 */
export async function formatCliHelp (command, version) {
  const definition = commands[command ?? 'build']
  const help = await formatHelpText({
    name: 'domstack',
    version,
    options: definition.options,
    headerFn: () => command
      ? `Usage: domstack ${command}${command === 'sessions' ? ' [id]' : ''} [options]\n\n${definition.description}\n`
      : [
          'Usage: domstack [command] [options]',
          '',
          'Build the site once when no command is given.',
          '',
          'Commands:',
          ...Object.entries(commands).map(([name, entry]) => `    ${name.padEnd(10)}${entry.description.split('\n')[0]}`),
          '    help      Show help for a command.',
          '',
          'Default build options are listed below.',
          '',
        ].join('\n'),
    exampleFn: () => `    Example: ${command ? definition.example : 'domstack --src website --dest public'}\n`,
    footerFn: () => [
      command ? 'Run "domstack help" to see all commands.' : 'Run "domstack <command> --help" or "domstack help <command>" for command help.',
      '',
      `domstack (v${version})`,
    ].join('\n'),
  })
  return `${styleText('cyan', domstackBanner)}\n\n${help}`
}
