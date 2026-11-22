import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'

export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return debounced
}

/**
 * Filters and the current page live in the URL (?q=&status=&page=2), so a
 * filtered view survives a refresh, works with Back, and can be shared.
 */
export function useUrlState<K extends string>(keys: readonly K[]) {
  const [params, setParams] = useSearchParams()
  const values = Object.fromEntries(keys.map((k) => [k, params.get(k) ?? ''])) as Record<K, string>

  function set(changes: Partial<Record<K | 'page' | 'pageSize', string | number | null>>, { resetPage = true } = {}) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const [key, value] of Object.entries(changes)) {
          if (value === null || value === '' || value === undefined) next.delete(key)
          else next.set(key, String(value))
        }
        if (resetPage && !('page' in changes)) next.delete('page')
        return next
      },
      { replace: true },
    )
  }

  const page = Math.max(1, Number(params.get('page')) || 1)
  const pageSize = [10, 20, 50].includes(Number(params.get('pageSize'))) ? Number(params.get('pageSize')) : undefined
  return { values, page, pageSize, set, hasFilters: keys.some((k) => params.get(k)) }
}
