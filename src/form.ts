import { useState, type ChangeEvent } from 'react'
import type { z } from 'zod'
import { fieldErrorsOf } from '../shared/schemas'
import { ApiError } from './api'

type Values = Record<string, string>

/**
 * Small form helper around the shared Zod schemas.
 * A field is checked when you leave it, re-checked as you type once it has
 * an error, and everything is checked on submit. Server errors are mapped
 * back onto the same fields.
 */
export function useZodForm<S extends z.ZodType>(schema: S, initial: Values) {
  const [values, setValues] = useState<Values>(initial)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)

  const check = (v: Values) => {
    const result = schema.safeParse(v)
    return result.success ? {} : fieldErrorsOf(result.error)
  }

  function set(name: string, value: string) {
    const next = { ...values, [name]: value }
    setValues(next)
    if (errors[name]) {
      const fresh = check(next)
      setErrors((e) => ({ ...e, [name]: fresh[name] ?? '' }))
    }
  }

  function field(name: string) {
    return {
      name,
      value: values[name] ?? '',
      error: errors[name] || undefined,
      onChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => set(name, e.target.value),
      onBlur: () => {
        const fresh = check(values)
        setErrors((e) => ({ ...e, [name]: fresh[name] ?? '' }))
      },
    }
  }

  async function submit(action: (data: z.output<S>) => Promise<void>) {
    setFormError(undefined)
    const result = schema.safeParse(values)
    if (!result.success) {
      setErrors(fieldErrorsOf(result.error))
      setFormError('Please fix the highlighted fields.')
      return
    }
    setSubmitting(true)
    try {
      await action(result.data)
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors)
        setFormError(err.message)
      } else {
        setFormError('Something went wrong. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return { values, set, field, errors, formError, setFormError, submitting, submit }
}
