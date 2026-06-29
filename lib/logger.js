/**
 * @import { LevelWithSilentOrString, Logger as PinoLogger } from 'pino'
 * @import { PrettyOptions } from 'pino-pretty'
 */
import pino from 'pino'
import pretty from 'pino-pretty'

/**
 * @param {LevelWithSilentOrString} [level]
 * @returns {PinoLogger}
 */
export function createDomStackLogger (level = 'info') {
  const isTTY = Boolean(process.stdout.isTTY)
  const stream = pretty({
    colorize: isTTY,
    colorizeObjects: isTTY,
    customColors: 'debug:gray,info:cyan,warn:yellow,error:red,fatal:bgRed',
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

/** @type {Exclude<NonNullable<PrettyOptions['messageFormat']>, string | false>} */
function formatPrettyMessage (log, messageKey) {
  const rawMessage = log[messageKey]
  const message = typeof rawMessage === 'string' ? rawMessage : String(rawMessage ?? '')
  const formatted = log['component'] === 'fastify'
    ? formatFastifyMessage(log, message)
    : message

  if (typeof log['logPrefix'] === 'string') return `${log['logPrefix']} ${formatted}`
  return formatted
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
  return value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : null
}
