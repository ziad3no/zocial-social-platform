const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const fullFmt = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' })

export const formatDate = (iso: string) => dateFmt.format(new Date(iso))
export const formatFull = (iso: string) => fullFmt.format(new Date(iso))
export const formatMonth = (iso: string) => monthFmt.format(new Date(iso))

/** "just now", "5m", "3h", "2d", then a date. Short, like most social apps. */
export function shortTime(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86_400) return `${Math.floor(s / 3600)}h`
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d`
  return formatDate(iso)
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
