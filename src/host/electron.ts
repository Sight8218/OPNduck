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


import type { DownloadProbe, DownloadRequest, Host, TaskState, YtDlpStatus } from './index'

/**
 * The bridge exposed by electron/preload.cjs via contextIsolation.
 * Cast through unknown to stay decoupled from the exact shape at build time
 * (in the browser this global simply doesn't exist).
 */
interface ElectronBridge {
  platformName: string
  isDesktop: true
  window: { minimize(): void; maximize(): void; close(): void }
  pickFile(options?: { extensions?: string[] }): Promise<string | null>
  pickFolder(): Promise<string | null>
  checkYtDlp(): Promise<YtDlpStatus>
  tasks: {
    startDownload(req: DownloadRequest): Promise<string>
    cancel(taskId: string): void
    list(): Promise<TaskState[]>
    onUpdate(listener: (tasks: TaskState[]) => void): () => void
    getDefaultDownloadDir(): Promise<string>
    probe(req: DownloadRequest): Promise<DownloadProbe>
  }
}

declare global {
  interface Window {
    opnduckHost?: ElectronBridge
  }
}

/** Build an Electron `Host` from the preload bridge, or return null in browser. */
export function detectElectronHost(): Host | null {
  const bridge = typeof window !== 'undefined' ? window.opnduckHost : undefined
  if (!bridge) return null

  let cachedTasks: TaskState[] = []
  const listeners = new Set<(tasks: TaskState[]) => void>()
  bridge.tasks.onUpdate((tasks) => {
    cachedTasks = tasks
    listeners.forEach((l) => l(tasks))
  })

  return {
    platformName: bridge.platformName,
    isDesktop: true,
    window: {
      minimize: () => bridge.window.minimize(),
      maximize: () => bridge.window.maximize(),
      close: () => bridge.window.close(),
    },
    pickFile: (options) => bridge.pickFile(options),
    pickFolder: () => bridge.pickFolder(),
    checkYtDlp: () => bridge.checkYtDlp(),
    tasks: {
      startDownload: (req) => bridge.tasks.startDownload(req),
      cancel: (taskId) => bridge.tasks.cancel(taskId),
      list: () => cachedTasks,
      subscribe: (listener) => {
        listeners.add(listener)
        listener(cachedTasks)
        return () => listeners.delete(listener)
      },
      getDefaultDownloadDir: () => bridge.tasks.getDefaultDownloadDir(),
      probe: (req) => bridge.tasks.probe(req),
    },
  }
}