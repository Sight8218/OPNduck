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


import type {
  ConvertRequest,
  AppSettings,
  UpdateCheck,
  DownloadProbe,
  DownloadRequest,
  Host,
  InterpolateRequest,
  SubtitlesRequest,
  TaskState,
  ToolStatus,
  UpscaleRequest,
} from './index'
import type { OmarchyTheme } from '../themes/omarchySync'

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
  pickFiles(options?: { extensions?: string[] }): Promise<string[] | null>
  pathForFile(file: File): string
  pickFolder(): Promise<string | null>
  checkYtDlp(): Promise<ToolStatus>
  checkFfmpeg(): Promise<ToolStatus>
  checkLibreOffice(): Promise<ToolStatus>
  checkRealesrgan(): Promise<ToolStatus>
  checkRife(): Promise<ToolStatus>
  checkFasterWhisper(): Promise<ToolStatus>
  settings: {
    get(): Promise<AppSettings>
    set(patch: { proxy?: string; cookies?: Partial<AppSettings['cookies']> }): Promise<AppSettings>
  }
  updates: {
    check(): Promise<UpdateCheck>
    openRelease(url: string): Promise<void>
  }
  omarchy: {
    get(): Promise<OmarchyTheme | null>
    subscribe(listener: (theme: OmarchyTheme | null) => void): () => void
  }
  tasks: {
    startDownload(req: DownloadRequest): Promise<string>
    startConvert(req: ConvertRequest): Promise<string>
    startUpscale(req: UpscaleRequest): Promise<string>
    startVideoUpscale(req: UpscaleRequest): Promise<string>
    startInterpolate(req: InterpolateRequest): Promise<string>
    startSubtitles(req: SubtitlesRequest): Promise<string>
    cancel(taskId: string): void
    rerun(taskId: string): Promise<string | null>
    openFolder(taskId: string): Promise<void>
    clearFinished(): Promise<void>
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

  // Seed from the main process: history persisted from earlier launches exists before
  // any 'tasks:update' broadcast would have fired.
  bridge.tasks.list().then((tasks) => {
    if (cachedTasks.length === 0 && tasks.length > 0) {
      cachedTasks = tasks
      listeners.forEach((l) => l(tasks))
    }
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
    pickFiles: (options) => bridge.pickFiles(options),
    pathForFile: (file) => bridge.pathForFile(file),
    pickFolder: () => bridge.pickFolder(),
    checkYtDlp: () => bridge.checkYtDlp(),
    checkFfmpeg: () => bridge.checkFfmpeg(),
    checkLibreOffice: () => bridge.checkLibreOffice(),
    checkRealesrgan: () => bridge.checkRealesrgan(),
    checkRife: () => bridge.checkRife(),
    checkFasterWhisper: () => bridge.checkFasterWhisper(),
    settings: {
      get: () => bridge.settings.get(),
      set: (patch) => bridge.settings.set(patch),
    },
    updates: {
      check: () => bridge.updates.check(),
      openRelease: (url) => bridge.updates.openRelease(url),
    },
    omarchy: {
      get: () => bridge.omarchy.get(),
      subscribe: (listener) => bridge.omarchy.subscribe(listener),
    },
    tasks: {
      startDownload: (req) => bridge.tasks.startDownload(req),
      startConvert: (req) => bridge.tasks.startConvert(req),
      startUpscale: (req) => bridge.tasks.startUpscale(req),
      startVideoUpscale: (req) => bridge.tasks.startVideoUpscale(req),
      startInterpolate: (req) => bridge.tasks.startInterpolate(req),
      startSubtitles: (req) => bridge.tasks.startSubtitles(req),
      cancel: (taskId) => bridge.tasks.cancel(taskId),
      rerun: (taskId) => bridge.tasks.rerun(taskId),
      openFolder: (taskId) => bridge.tasks.openFolder(taskId),
      clearFinished: () => bridge.tasks.clearFinished(),
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