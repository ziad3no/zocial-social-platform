import type { ErrorRequestHandler } from 'express'
import type { z } from 'zod'
import { fieldErrorsOf } from '../shared/schemas'

/** An error with an HTTP status and a message that is safe to show the user. */
export class HttpError extends Error {
  status: number
  fieldErrors?: Record<string, string>

  constructor(status: number, message: string, fieldErrors?: Record<string, string>) {
    super(message)
    this.status = status
    this.fieldErrors = fieldErrors
  }
}

export const badRequest = (message: string, fieldErrors?: Record<string, string>) =>
  new HttpError(400, message, fieldErrors)
export const forbidden = (message = 'You don’t have permission to do that.') => new HttpError(403, message)
export const notFound = (what = 'That item') => new HttpError(404, `${what} was not found. It may have been deleted.`)
export const conflict = (message: string, fieldErrors?: Record<string, string>) =>
  new HttpError(409, message, fieldErrors)

/** Validate input with a shared schema, or throw a 400 listing each bad field. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input)
  if (!result.success) {
    throw badRequest('Please fix the highlighted fields.', fieldErrorsOf(result.error))
  }
  return result.data
}

export function parseId(raw: unknown): number {
  const id = Number(raw)
  if (!Number.isInteger(id) || id <= 0) throw notFound()
  return id
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { message: err.message, fieldErrors: err.fieldErrors } })
    return
  }
  // Postgres unique violation: two requests raced to create the same thing.
  if (err?.code === '23505') {
    res.status(409).json({ error: { message: 'That already exists. Please refresh and try again.' } })
    return
  }
  // body-parser errors (bad JSON, body too large) carry a status
  const status = typeof err?.status === 'number' ? err.status : 500
  if (status >= 400 && status < 500) {
    const message = err.type === 'entity.parse.failed' ? 'The request body is not valid JSON.' : 'The request was rejected.'
    res.status(status).json({ error: { message } })
    return
  }
  console.error(err)
  res.status(500).json({ error: { message: 'Something went wrong on our side. Please try again.' } })
}
