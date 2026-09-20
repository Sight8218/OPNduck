/*
 * OPNduck — local-first media processing suite.
 * Copyright (C) 2026 Aaron Jonsson
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import Tag from '../components/Tag'
import Thumbnail from '../components/Thumbnail'
import { host, type TaskState } from '../host'
import { formatBytes } from '../lib/formatBytes'
import { useTasks } from '../lib/useTasks'

const STATUS_LABEL: Record<TaskState['status'], string> = {
  queued: 'Queued',
  running: 'Downloading',
  done: 'Done',
  error: 'Error',
  canceled: 'Canceled',
}

function TaskRow({ task }: { task: TaskState }) {
  const running = task.status === 'queued' || task.status === 'running'
  const size = formatBytes(task.sizeBytes)
  return (
    <div className="glass flex flex-col gap-2 rounded-2xl p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Thumbnail url={task.thumbnailUrl} className="h-10 w-[72px] shrink-0 rounded-lg" />
          <span className="truncate text-sm font-medium">{task.label}</span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-xs text-[var(--text-dim)]">{STATUS_LABEL[task.status]}</span>
          {running && (
            <button
              type="button"
              className="glass-btn px-2 py-1 text-xs"
              onClick={() => host.tasks.cancel(task.id)}
            >
              Cancel
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Tag>{task.format}</Tag>
        <Tag>{task.quality}</Tag>
        {size && (
          <Tag>
            {task.sizeIsEstimate ? '~' : ''}
            {size}
          </Tag>
        )}
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--input-bg)]">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${
            task.status === 'error' ? 'bg-red-500' : 'bg-[var(--accent)]'
          }`}
          style={{ width: `${Math.round(task.progress * 100)}%` }}
        />
      </div>
      {task.error && <span className="text-xs text-red-400">{task.error}</span>}
    </div>
  )
}

// @category: downloader/downloads-queue-page
export default function Downloads() {
  const tasks = useTasks()

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <h1 className="mb-1 text-2xl font-extrabold sm:text-3xl">Downloads</h1>
      <p className="mb-6 text-sm text-[var(--text-dim)]">
        Track and manage your download queue.
      </p>

      {tasks.length === 0 ? (
        <div className="glass flex items-center justify-center rounded-3xl p-10 text-sm text-[var(--text-dim)]">
          No downloads yet — start one from the Downloader card on Home.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
        </div>
      )}
    </div>
  )
}
// --- end: downloader/downloads-queue-page ---
