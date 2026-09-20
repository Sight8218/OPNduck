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

import { useEffect, useState } from 'react'
import { host, type TaskState } from '../host'

// @category: downloader/task-queue-state
/** Live view of every in-flight/finished task, shared across every subscriber. */
export function useTasks(): TaskState[] {
  const [tasks, setTasks] = useState<TaskState[]>(() => host.tasks.list())

  useEffect(() => host.tasks.subscribe(setTasks), [])

  return tasks
}
// --- end: downloader/task-queue-state ---
