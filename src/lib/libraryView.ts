import type { TaskKind, TaskState } from '../host'

/** Pure view logic for the Library page (search, filter, sort, group) — no React, easy to test. */
export type KindFilter = 'all' | TaskKind
export type StatusFilter = 'all' | 'active' | 'done' | 'failed'
export type SortKey = 'newest' | 'oldest' | 'name' | 'size' | 'status'

export interface ViewOptions {
  query: string
  kind: KindFilter
  status: StatusFilter
  sort: SortKey
}

export const DEFAULT_VIEW: ViewOptions = { query: '', kind: 'all', status: 'all', sort: 'newest' }

export type LibraryItem =
  | { type: 'task'; task: TaskState }
  | { type: 'group'; id: string; label: string; tasks: TaskState[] }

const isActive = (t: TaskState) => t.status === 'queued' || t.status === 'running'
const isFailed = (t: TaskState) => t.status === 'error' || t.status === 'canceled'

/** Lower = shown first when sorting by status: running work, then queued, failures, finished. */
const STATUS_RANK: Record<TaskState['status'], number> = { running: 0, queued: 1, error: 2, canceled: 3, done: 4 }

function matches(t: TaskState, o: ViewOptions): boolean {
  if (o.kind !== 'all' && t.kind !== o.kind) return false
  if (o.status === 'active' && !isActive(t)) return false
  if (o.status === 'done' && t.status !== 'done') return false
  if (o.status === 'failed' && !isFailed(t)) return false
  const q = o.query.trim().toLowerCase()
  if (!q) return true
  return [t.label, t.format, t.quality, t.error ?? '', t.group?.label ?? ''].some((v) => v.toLowerCase().includes(q))
}

const created = (t: TaskState) => t.createdAt ?? 0

/** Sort key for a whole item: a group sorts by its newest member / summed size / best status. */
function sortValue(item: LibraryItem, key: SortKey): number | string {
  const tasks = item.type === 'task' ? [item.task] : item.tasks
  switch (key) {
    case 'newest':
    case 'oldest':
      return Math.max(...tasks.map(created))
    case 'name':
      return (item.type === 'task' ? item.task.label : item.label).toLowerCase()
    case 'size':
      return tasks.reduce((sum, t) => sum + (t.sizeBytes ?? 0), 0)
    case 'status':
      return Math.min(...tasks.map((t) => STATUS_RANK[t.status]))
  }
}

export function applyView(tasks: TaskState[], o: ViewOptions): LibraryItem[] {
  const kept = tasks.filter((t) => matches(t, o))

  // Members of a batch collapse into one group (only if 2+ of them survive the filter).
  const byGroup = new Map<string, TaskState[]>()
  for (const t of kept) {
    if (!t.group) continue
    const members = byGroup.get(t.group.id)
    if (members) members.push(t)
    else byGroup.set(t.group.id, [t])
  }
  const items: LibraryItem[] = []
  const emitted = new Set<string>()
  for (const t of kept) {
    const members = t.group ? byGroup.get(t.group.id) : undefined
    if (t.group && members && members.length > 1) {
      if (emitted.has(t.group.id)) continue
      emitted.add(t.group.id)
      // Within a group keep the order the jobs were started in.
      items.push({ type: 'group', id: t.group.id, label: t.group.label, tasks: [...members].sort((a, b) => created(a) - created(b)) })
    } else {
      items.push({ type: 'task', task: t })
    }
  }

  const dir = o.sort === 'oldest' || o.sort === 'name' || o.sort === 'status' ? 1 : -1
  return items.sort((a, b) => {
    const x = sortValue(a, o.sort)
    const y = sortValue(b, o.sort)
    const cmp = typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y) : Number(x) - Number(y)
    // Stable, deterministic ties: newest first.
    return cmp !== 0 ? dir * cmp : Number(sortValue(b, 'newest')) - Number(sortValue(a, 'newest'))
  })
}

export interface GroupSummary {
  total: number
  done: number
  failed: number
  active: number
  /** 0–1 average progress across the group. */
  progress: number
}

export function summarizeGroup(tasks: TaskState[]): GroupSummary {
  const done = tasks.filter((t) => t.status === 'done').length
  const failed = tasks.filter(isFailed).length
  const active = tasks.filter(isActive).length
  const progress = tasks.length ? tasks.reduce((s, t) => s + (t.status === 'done' ? 1 : t.progress), 0) / tasks.length : 0
  return { total: tasks.length, done, failed, active, progress }
}
