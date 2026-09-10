/**
 * @import { LevelWithSilentOrString, Logger as PinoLogger } from 'pino'
 * @import { PrettyOptions } from 'pino-pretty'
 * @typedef {Exclude<NonNullable<PrettyOptions['messageFormat']>, string | false>} PrettyMessageFormatter
 */
import pino from 'pino'
import pretty from 'pino-pretty'
import { isPlainObject } from './helpers/type-guards.js'

/**
 * @param {LevelWithSilentOrString} [level]
 * @returns {PinoLogger}
 */
export function createDomStackLogger (level = 'info') {
  const isTTY = Boolean(process.stdout.isTTY)
  const stream = pretty({
    colorize: isTTY,
    colorizeObjects: isTTY,
    customColors: 'message:reset,debug:gray,info:green,warn:yellow,error:red,fatal:bgRed',
    hideObject: false,
    levelFirst: true,
    singleLine: true,
    ignore: 'pid,hostname,time,logPrefix,component,req,reqId,res,responseTime',
    messageFormat: formatPrettyMessage,
    sync: true,
  })

  return pino({
    level,
    base: null,
    timestamp: false,
  }, stream)
}

/** @type {PrettyMessageFormatter} */
function formatPrettyMessage (log, messageKey, _levelLabel, { colors }) {
  const rawMessage = log[messageKey]
  const message = typeof rawMessage === 'string' ? rawMessage : String(rawMessage ?? '')
  const formatted = log['component'] === 'fastify'
    ? formatFastifyMessage(log, message)
    : log['component'] === 'sync'
      ? formatSyncMessage(log, message, colors)
      : message

  if (typeof log['logPrefix'] === 'string') return `${colors.magenta(log['logPrefix'])} ${formatted}`
  return formatted
}

/**
 * @param {Record<string, unknown>} log
 * @param {string} message
 * @param {Parameters<PrettyMessageFormatter>[3]['colors']} colors
 */
function formatSyncMessage (log, message, colors) {
  // Sync currently emits access-table rows as unprefixed text, not structured fields.
  if (log['logPrefix'] === false) {
    if (/^\s+-+$/.test(message)) return colors.gray(message)
    const row = /^(\s+)([^:\r\n]+:)(\s+)(https?:\/\/\S+)$/.exec(message)
    if (row) {
      const [, padding = '', label = '', spacing = '', url = ''] = row
      return `${padding}${colors.bold(label)}${spacing}${colors.cyan(url)}`
    }
  }

  if (typeof log['url'] === 'string' && log['url'].length > 0) {
    return message.split(log['url']).join(colors.cyan(log['url']))
  }
  if (message.endsWith(':')) return colors.bold(message)
  return message
}

/**
 * @param {Record<string, unknown>} log
 * @param {string} fallback
 */
function formatFastifyMessage (log, fallback) {
  const req = getRecord(log['req'])
  const res = getRecord(log['res'])
  const method = typeof req?.['method'] === 'string' ? req['method'] : null
  const url = typeof req?.['url'] === 'string' ? req['url'] : null

  if (res) {
    const statusCode = typeof res['statusCode'] === 'number' ? res['statusCode'] : null
    const responseTime = typeof log['responseTime'] === 'number' ? `${Math.round(log['responseTime'])}ms` : null
    return [
      'HTTP response:',
      method,
      url,
      statusCode ? `-> ${statusCode}` : null,
      responseTime ? `(${responseTime})` : null,
    ].filter(Boolean).join(' ')
  }

  if (req) {
    return ['HTTP request:', method, url].filter(Boolean).join(' ')
  }

  return fallback
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function getRecord (value) {
  return isPlainObject(value) ? value : null
}
