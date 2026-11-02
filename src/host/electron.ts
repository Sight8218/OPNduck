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
  AudioAiRequest,
  ImportedTask,
  Subscription,
  SubscriptionInput,
  UpdateCheck,
  DownloadProbe,
  DownloadRequest,
  Host,
  InterpolateRequest,
  PythonTool,
  SubtitlesRequest,
  TaskState,
  ToolStatus,
  UpscaleRequest,
  TrimRequest,
  CompressRequest,
  TagRequest,
  GifRequest,
  TagLookup,
  MediaInfo,
  McpInfo,
  HostPlugins,
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
  installYtDlp(): Promise<{ ok: boolean; error?: string }>
  checkFfmpeg(): Promise<ToolStatus>
  checkFpcalc(): Promise<ToolStatus>
  tagger: { identify(filePath: string): Promise<TagLookup>; listAudio(folder: string): Promise<string[]> }
  checkLibreOffice(): Promise<ToolStatus>
  checkRealesrgan(): Promise<ToolStatus>
  checkRife(): Promise<ToolStatus>
  checkFasterWhisper(): Promise<ToolStatus>
  checkDemucs(): Promise<ToolStatus>
  dev: NonNullable<Host['dev']>
  mcp: { info(): Promise<McpInfo>; resetToken(): Promise<McpInfo> }
  plugins: HostPlugins
  queue: {
    state(): Promise<{ paused: boolean }>
    setPaused(paused: boolean): Promise<void>
    onState(listener: (s: { paused: boolean }) => void): () => void
  }
  checkTorchEngine(): Promise<{ available: boolean; nvidia: boolean }>
  probeMedia(path: string): Promise<MediaInfo | null>
  mediaFrame(path: string, time: number, width?: number): Promise<string | null>
  mediaThumbs(path: string, duration: number, count?: number): Promise<(string | null)[]>
  installTool(tool: PythonTool): Promise<{ ok: boolean; error?: string }>
  cancelInstall(): Promise<void>
  onInstallProgress(listener: (p: { tool: PythonTool; line: string }) => void): () => void
  settings: {
    get(): Promise<AppSettings>
    set(patch: { proxy?: string; gpuThreads?: AppSettings['gpuThreads']; upscaleEngine?: AppSettings['upscaleEngine']; videoEncoder?: AppSettings['videoEncoder']; notifyOnFinish?: boolean; runInTray?: boolean; mcpServer?: boolean; maxDownloads?: number; maxConversions?: number; watchFolder?: Partial<AppSettings['watchFolder']>; cookies?: Partial<AppSettings['cookies']> }): Promise<AppSettings>
  }
  subscriptions: {
    list(): Promise<Subscription[]>
    add(input: SubscriptionInput): Promise<Subscription>
    remove(id: string): Promise<void>
    setEnabled(id: string, enabled: boolean): Promise<void>
    checkNow(id?: string): Promise<{ started: number; busy: boolean }>
    onChange(listener: (list: Subscription[]) => void): () => void
  }
  library: {
    exportHistory(): Promise<{ ok: boolean; count: number; path?: string }>
    importHistory(): Promise<{ ok: boolean; entries: ImportedTask[]; error?: string }>
    importApply(entries: ImportedTask[], run: boolean): Promise<{ added: number; started: number }>
  }
  login: {
    open(url?: string): Promise<{ ok: boolean; cookies: number; error?: string }>
    status(): Promise<{ signedIn: boolean; cookies: number; updatedAt: number | null }>
    clear(): Promise<void>
    test(): Promise<{ ok: boolean; message: string }>
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
    startAudioAi(req: AudioAiRequest): Promise<string>
    startTrim(req: TrimRequest): Promise<string>
    startCompress(req: CompressRequest): Promise<string>
    startTag(req: TagRequest): Promise<string>
    startGif(req: GifRequest): Promise<string>
    cancel(taskId: string): void
    rerun(taskId: string, opts?: { anotherMatch?: boolean }): Promise<string | null>
    openFolder(taskId: string): Promise<void>
    clearFinished(): Promise<void>
    remove(ids: string[]): Promise<number>
    list(): Promise<TaskState[]>
    runNext(taskId: string): Promise<boolean>
    logs(taskId: string): Promise<string[]>
    watchLog(taskId: string, on: boolean): Promise<void>
    onLog(listener: (p: { id: string; lines: string[]; replaceLast: boolean }) => void): () => void
    onUpdate(listener: (update: { full: boolean; tasks: TaskState[] }) => void): () => void
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
  bridge.tasks.onUpdate(({ full, tasks }) => {
    if (full) {
      cachedTasks = tasks
    } else {
      // A progress tick: only the active tasks came, so merge them by id into what we have.
      const byId = new Map(tasks.map((t) => [t.id, t]))
      const seen = new Set<string>()
      cachedTasks = cachedTasks.map((t) => {
        seen.add(t.id)
        return byId.get(t.id) ?? t
      })
      for (const t of tasks) if (!seen.has(t.id)) cachedTasks.push(t)
    }
    listeners.forEach((l) => l(cachedTasks))
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
    installYtDlp: () => bridge.installYtDlp(),
    checkFfmpeg: () => bridge.checkFfmpeg(),
    checkFpcalc: () => bridge.checkFpcalc(),
    tagger: bridge.tagger,
    checkLibreOffice: () => bridge.checkLibreOffice(),
    checkRealesrgan: () => bridge.checkRealesrgan(),
    checkRife: () => bridge.checkRife(),
    checkFasterWhisper: () => bridge.checkFasterWhisper(),
    checkDemucs: () => bridge.checkDemucs(),
    checkTorchEngine: () => bridge.checkTorchEngine(),
    probeMedia: (p) => bridge.probeMedia(p),
    mediaFrame: (p, t, w) => bridge.mediaFrame(p, t, w),
    mediaThumbs: (p, d, c) => bridge.mediaThumbs(p, d, c),
    installTool: (tool, onProgress) => {
      const off = bridge.onInstallProgress((p) => p.tool === tool && onProgress?.(p.line))
      return bridge.installTool(tool).finally(off)
    },
    cancelInstall: () => bridge.cancelInstall(),
    dev: bridge.dev,
    mcp: { info: () => bridge.mcp.info(), resetToken: () => bridge.mcp.resetToken() },
    plugins: bridge.plugins,
    queue: {
      state: () => bridge.queue.state(),
      setPaused: (paused) => bridge.queue.setPaused(paused),
      subscribe: (listener) => bridge.queue.onState(listener),
    },
    settings: {
      get: () => bridge.settings.get(),
      set: (patch) => bridge.settings.set(patch),
    },
    subscriptions: {
      list: () => bridge.subscriptions.list(),
      add: (input) => bridge.subscriptions.add(input),
      remove: (id) => bridge.subscriptions.remove(id),
      setEnabled: (id, enabled) => bridge.subscriptions.setEnabled(id, enabled),
      checkNow: (id) => bridge.subscriptions.checkNow(id),
      subscribe: (listener) => bridge.subscriptions.onChange(listener),
    },
    library: {
      exportHistory: () => bridge.library.exportHistory(),
      importHistory: () => bridge.library.importHistory(),
      importApply: (entries, run) => bridge.library.importApply(entries, run),
    },
    login: {
      open: (url) => bridge.login.open(url),
      status: () => bridge.login.status(),
      clear: () => bridge.login.clear(),
      test: () => bridge.login.test(),
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
      startAudioAi: (req) => bridge.tasks.startAudioAi(req),
      startTrim: (req) => bridge.tasks.startTrim(req),
      startCompress: (req) => bridge.tasks.startCompress(req),
      startTag: (req) => bridge.tasks.startTag(req),
      startGif: (req) => bridge.tasks.startGif(req),
      cancel: (taskId) => bridge.tasks.cancel(taskId),
      runNext: (taskId) => bridge.tasks.runNext(taskId),
      logs: (taskId) => bridge.tasks.logs(taskId),
      watchLog: (taskId, listener) => {
        const off = bridge.tasks.onLog((p) => p.id === taskId && listener({ lines: p.lines, replaceLast: p.replaceLast }))
        void bridge.tasks.watchLog(taskId, true)
        return () => {
          off()
          void bridge.tasks.watchLog(taskId, false)
        }
      },
      rerun: (taskId, opts) => bridge.tasks.rerun(taskId, opts),
      openFolder: (taskId) => bridge.tasks.openFolder(taskId),
      clearFinished: () => bridge.tasks.clearFinished(),
      remove: (ids) => bridge.tasks.remove(ids),
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