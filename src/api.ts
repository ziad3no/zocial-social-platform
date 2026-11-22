import type { ApiErrorBody } from '../shared/types'

/** An API failure with a message that is safe to show, plus per-field errors for forms. */
export class ApiError extends Error {
  status: number
  fieldErrors: Record<string, string>

  constructor(status: number, message: string, fieldErrors: Record<string, string> = {}) {
    super(message)
    this.status = status
    this.fieldErrors = fieldErrors
  }
}

type Query = Record<string, string | number | undefined | null>

/** Listeners are told when any call comes back 401, so the app can return to the sign-in page. */
const unauthorizedListeners = new Set<() => void>()
export function onUnauthorized(fn: () => void) {
  unauthorizedListeners.add(fn)
  return () => void unauthorizedListeners.delete(fn)
}

export async function api<T>(path: string, options: { method?: string; body?: unknown; query?: Query } = {}): Promise<T> {
  const url = new URL(`/api${path}`, window.location.origin)
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
  }

  let res: Response
  try {
    res = await fetch(url, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      headers: {
        'X-Requested-With': 'zocial',
        ...(options.body !== undefined && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body instanceof FormData ? options.body : options.body !== undefined ? JSON.stringify(options.body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'Can’t reach the server. Check your connection and try again.')
  }

  if (res.status === 204) return undefined as T
  const data = (await res.json().catch(() => null)) as (T & Partial<ApiErrorBody>) | null

  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login' && path !== '/auth/me') unauthorizedListeners.forEach((fn) => fn())
    const message = data?.error?.message ?? `The server returned an error (${res.status}). Please try again.`
    throw new ApiError(res.status, message, data?.error?.fieldErrors ?? {})
  }
  return data as T
}

export const errorMessage = (err: unknown) =>
  err instanceof ApiError ? err.message : 'Something went wrong. Please try again.'
