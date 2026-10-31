import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** `~` and relative paths become absolute, so the job core accepts them. */
export function absolutePath(input) {
  const p = input.trim()
  if (p === '~' || p.startsWith('~/')) return path.join(os.homedir(), p.slice(1))
  return path.resolve(p)
}

const common = (names) => {
  let prefix = names[0] ?? ''
  for (const n of names) while (!n.startsWith(prefix)) prefix = prefix.slice(0, -1)
  return prefix
}

/** Tab completion for a path being typed: the completed text and up to `max` matching names. */
export function completePath(input, max = 6) {
  const expanded = input.startsWith('~') ? path.join(os.homedir(), input.slice(1)) : input
  const dir = expanded.endsWith('/') || expanded === '' ? expanded || '.' : path.dirname(expanded)
  const base = expanded.endsWith('/') || expanded === '' ? '' : path.basename(expanded)
  let names = []
  try {
    names = fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.name.startsWith(base) && (base.startsWith('.') || !e.name.startsWith('.')))
      .map((e) => e.name + (e.isDirectory() ? '/' : ''))
      .sort()
  } catch {
    return { text: input, candidates: [] }
  }
  if (!names.length) return { text: input, candidates: [] }
  const shared = common(names)
  const head = input.endsWith('/') || input === '' ? input : input.slice(0, input.length - base.length)
  return { text: head + shared, candidates: names.slice(0, max), more: Math.max(0, names.length - max) }
}

/** "90", "1:30" or "0:01:30.5" as seconds; null when empty or unreadable. */
export function parseTime(text) {
  const t = text.trim()
  if (!t) return null
  const parts = t.split(':').map(Number)
  if (parts.some((n) => !Number.isFinite(n) || n < 0) || parts.length > 3) return NaN
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}
