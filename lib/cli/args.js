/**
 * @import { ArgscloptsParseArgsOptionsConfig } from 'argsclopts'
 * @import { CommandName } from './options.js'
 * @typedef {Record<string, string | boolean | (string | boolean)[] | undefined>} CliValues
 * @typedef {{ command: CommandName, values: CliValues, helpCommand: CommandName | null }} CliArgs
 */

import { parseArgs } from 'node:util'
import { commands, isCommand, legacyOptions } from './options.js'

export class CliUsageError extends Error {
  /**
   * @param {string} message
   * @param {CommandName | null} [command]
   */
  constructor (message, command = null) {
    super(message)
    this.name = 'CliUsageError'
    this.command = command
  }
}

/** @type {ArgscloptsParseArgsOptionsConfig} */
const compatibilityOptions = {
  ...commands.build.options,
  ...commands.watch.options,
  ...commands.serve.options,
  ...commands.eject.options,
  ...legacyOptions,
}

/**
 * Resolve only a leading command; option values may themselves be command names.
 * @param {string[]} args
 * @returns {CliArgs}
 */
export function parseCliArgs (args) {
  /** @type {CommandName | null} */
  let helpCommand = null
  /** @type {CommandName} */
  let command = 'build'
  let commandArgs = args

  try {
    const first = args[0]
    if (first === 'help') {
      const target = args[1]
      if (target !== undefined && !isCommand(target)) {
        throw new CliUsageError(`Unknown command: ${target}`)
      }
      helpCommand = target ?? null
      if (args.length > 2) throw new CliUsageError('Usage: domstack help [command]', helpCommand)
      return { command: target ?? 'build', values: { help: true }, helpCommand }
    }

    if (first !== undefined && !first.startsWith('-')) {
      if (!isCommand(first)) throw new CliUsageError(`Unknown command: ${first}`)
      command = first
      helpCommand = command
      commandArgs = args.slice(1)
    } else {
      // Tokenize with the legacy vocabulary, then reparse only explicit options
      // against the selected command. Defaults from other commands must not leak.
      const { tokens } = parseArgs({ args, options: compatibilityOptions, tokens: true, strict: true, allowPositionals: false })
      const modes = new Set(tokens.flatMap(token => token.kind === 'option' && Object.hasOwn(legacyOptions, token.name) ? [token.name] : []))
      if (modes.size > 1) {
        throw new CliUsageError(`Conflicting modes: ${[...modes].map(mode => `--${mode}`).join(', ')}`)
      }
      const mode = [...modes][0]
      if (mode !== undefined) {
        command = mode === 'watch-only' ? 'watch' : /** @type {CommandName} */ (mode)
        helpCommand = command
      }
      commandArgs = []
      for (const token of tokens) {
        if (token.kind === 'option' && !Object.hasOwn(legacyOptions, token.name)) {
          // Inline values preserve short groups, repeated options, and values
          // beginning with '-' without confusing them with another option.
          commandArgs.push(token.value === undefined ? `--${token.name}` : `--${token.name}=${token.value}`)
        } else if (token.kind === 'option-terminator') {
          commandArgs.push('--')
        }
      }
      if (mode === 'watch-only') commandArgs.unshift('--no-serve')
    }

    /** @type {ArgscloptsParseArgsOptionsConfig} */
    const options = commands[command].options
    const { values } = parseArgs({ args: commandArgs, options, strict: true, allowPositionals: false })
    if (!values['help'] && !values['version']) validateValues(command, values)
    return { command, values, helpCommand }
  } catch (error) {
    if (error instanceof CliUsageError) throw error
    if (error instanceof Error) throw new CliUsageError(error.message, helpCommand)
    throw error
  }
}

/**
 * @param {CommandName} command
 * @param {CliValues} values
 */
function validateValues (command, values) {
  if (!values['src']) throw new Error('The src flag is required')
  if (command !== 'eject' && !values['dest']) throw new Error('The dest flag is required')
  if (command === 'eject' && values['language'] !== 'js' && values['language'] !== 'ts') {
    throw new Error('--language must be ts or js')
  }
  if (values['port'] !== undefined) {
    const port = Number(values['port'])
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('--port must be an integer between 1 and 65535')
    }
  }
}
