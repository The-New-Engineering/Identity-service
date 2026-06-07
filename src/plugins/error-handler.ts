import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'
import { buildError } from '../types/error'

/**
 * Extracts the field name from a Postgres error detail string.
 *
 * Postgres detail examples:
 *   'Key (code)=(LAG-001) already exists.'
 *   'Key (installation_id)=(abc-123) is not present in table "installations".'
 *
 * Falls back to the column property (present on 23502 not-null violations)
 * then to 'unknown' if neither is available.
 */
function extractPostgresField(error: any): string {
  if (error.detail) {
    const match = error.detail.match(/Key \((\w+)\)/)
    if (match) return match[1]
  }
  if (error.column) return error.column
  return 'unknown'
}

const POSTGRES_ERRORS: Record<string, { status: number; code: string; message: (field: string) => string }> = {
  '23505': {
    status: 409,
    code: 'DUPLICATE_ENTRY',
    message: (field) => `A record with this ${field} already exists`,
  },
  '23503': {
    status: 422,
    code: 'INVALID_REFERENCE',
    message: (field) => `${field} does not reference a valid record`,
  },
  '23502': {
    status: 400,
    code: 'MISSING_FIELD',
    message: (field) => `${field} is required`,
  },
  '22P02': {
    status: 400,
    code: 'INVALID_ID',
    message: (field) => `${field} is not a valid ID format`,
  },
}

export default fp(async (app: FastifyInstance) => {
  app.setErrorHandler((error, req, reply) => {
    const requestId = req.id
    const statusCode = error.statusCode ?? 500

    // Fastify validation errors — field-level detail
    if (error.validation) {
      app.log.warn({ err: error, requestId }, 'Validation error')
      return reply.status(400).send(
        buildError(
          'VALIDATION_ERROR',
          'Request validation failed',
          requestId,
          error.validation.map((v) => ({
            field: v.instancePath?.replace('/', '') ?? v.params?.missingProperty,
            message: v.message ?? 'Invalid value',
          }))
        )
      )
    }

    // Postgres constraint errors — translate to client errors with field context
    const pgError = POSTGRES_ERRORS[(error as any).code]
    if (pgError) {
      const field = extractPostgresField(error)
      app.log.warn({ err: error, requestId, field }, 'Postgres constraint violation')
      return reply.status(pgError.status).send(
        buildError(pgError.code, pgError.message(field), requestId)
      )
    }

    // Known application errors thrown with a statusCode
    if (statusCode < 500) {
       app.log.warn(
        { err: error, requestId, statusCode, code: error.code ?? 'CLIENT_ERROR' },
        `Client error ${statusCode}: ${error.message}`
      )
      return reply.status(statusCode).send(
        buildError(error.code ?? 'CLIENT_ERROR', error.message, requestId)
      )
    }

    // Unknown server errors — log full detail, return safe message
     app.log.error(
      {
        err: {
          message: error.message,
          stack:   error.stack,
          code:    error.code,
          name:    error.name,
        },
        requestId,
        method:     req.method,
        url:        req.url,
        statusCode: 500,
      },
      `Unhandled server error: ${error.message}`
    )
    return reply.status(500).send(
      buildError('INTERNAL_ERROR', 'An unexpected error occurred', requestId)
    )
  })
})