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

const { contextBridge, ipcRenderer, webUtils } = require('electron')

/** Safe, minimal bridge exposed to the renderer as `window.opnduckHost`. */
contextBridge.exposeInMainWorld('opnduckHost', {
  platformName: process.platform,
  isDesktop: true,
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },
  pickFile: (options) => ipcRenderer.invoke('dialog:pickFile', options ?? null),
  pickFiles: (options) => ipcRenderer.invoke('dialog:pickFiles', options ?? null),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  // Dropped File objects carry no path in a sandboxed renderer; this resolves one.
  pathForFile: (file) => webUtils.getPathForFile(file),
  checkYtDlp: () => ipcRenderer.invoke('system:checkYtDlp'),
  installYtDlp: () => ipcRenderer.invoke('system:installYtDlp'),
  checkFfmpeg: () => ipcRenderer.invoke('system:checkFfmpeg'),
  checkFpcalc: () => ipcRenderer.invoke('system:checkFpcalc'),
  schedule: {
    status: () => ipcRenderer.invoke('schedule:status'),
    cancelCountdown: () => ipcRenderer.invoke('schedule:cancelCountdown'),
    onChange: (listener) => {
      const handler = () => listener()
      ipcRenderer.on('schedule:changed', handler)
      return () => ipcRenderer.removeListener('schedule:changed', handler)
    },
    onCountdown: (listener) => {
      const handler = (_e, data) => listener(data)
      ipcRenderer.on('queue:countdown', handler)
      return () => ipcRenderer.removeListener('queue:countdown', handler)
    },
  },
  servers: {
    list: () => ipcRenderer.invoke('servers:list'),
    add: (link) => ipcRenderer.invoke('servers:add', link),
    check: (id) => ipcRenderer.invoke('servers:check', id),
    remove: (id) => ipcRenderer.invoke('servers:remove', id),
    setDefault: (kind, where) => ipcRenderer.invoke('servers:setDefault', kind, where),
    shareState: () => ipcRenderer.invoke('share:state'),
    sharePairLink: () => ipcRenderer.invoke('share:pairLink'),
    shareRevoke: (id) => ipcRenderer.invoke('share:revoke', id),
    onChange: (listener) => {
      const handler = () => listener()
      ipcRenderer.on('servers:changed', handler)
      return () => ipcRenderer.removeListener('servers:changed', handler)
    },
  },
  remote: {
    state: () => ipcRenderer.invoke('remote:state'),
    relay: () => ipcRenderer.invoke('remote:relay'),
    setRelay: (server, token) => ipcRenderer.invoke('remote:setRelay', server, token),
    server: () => ipcRenderer.invoke('remote:server'),
    pairing: () => ipcRenderer.invoke('remote:pairing'),
    resetPairing: () => ipcRenderer.invoke('remote:resetPairing'),
    tailscale: () => ipcRenderer.invoke('remote:tailscale'),
    tailscaleServe: (on) => ipcRenderer.invoke('remote:tailscaleServe', on === true),
    accept: (id) => ipcRenderer.invoke('remote:accept', id),
    dismiss: (id) => ipcRenderer.invoke('remote:dismiss', id),
    onChange: (listener) => {
      const handler = () => listener()
      ipcRenderer.on('remote:changed', handler)
      return () => ipcRenderer.removeListener('remote:changed', handler)
    },
  },
  recipes: {
    list: () => ipcRenderer.invoke('recipes:list'),
    tools: () => ipcRenderer.invoke('recipes:tools'),
    filesIn: (folder, input) => ipcRenderer.invoke('recipes:filesIn', folder, input),
    save: (recipe) => ipcRenderer.invoke('recipes:save', recipe),
    remove: (id) => ipcRenderer.invoke('recipes:remove', id),
    duplicate: (id) => ipcRenderer.invoke('recipes:duplicate', id),
    run: (id, input, opts) => ipcRenderer.invoke('recipes:run', id, input, opts ?? null),
    resume: (runId) => ipcRenderer.invoke('recipes:resume', runId),
  },
  ai: {
    state: () => ipcRenderer.invoke('ai:state'),
    test: () => ipcRenderer.invoke('ai:test'),
    usage: () => ipcRenderer.invoke('ai:usage'),
    setKey: (id, key) => ipcRenderer.invoke('ai:setKey', id, key),
    removeKey: (id) => ipcRenderer.invoke('ai:removeKey', id),
    local: {
      status: () => ipcRenderer.invoke('ai:local:status'),
      installRuntime: () => ipcRenderer.invoke('ai:local:installRuntime'),
      installModel: (id) => ipcRenderer.invoke('ai:local:installModel', id),
      cancel: () => ipcRenderer.invoke('ai:local:cancel'),
      load: () => ipcRenderer.invoke('ai:local:load'),
      eject: () => ipcRenderer.invoke('ai:local:eject'),
      remove: (id) => ipcRenderer.invoke('ai:local:remove', id),
      onChange: (listener) => {
        const handler = (_e, s) => listener(s)
        ipcRenderer.on('ai:local', handler)
        return () => ipcRenderer.removeListener('ai:local', handler)
      },
    },
    send: (req) => ipcRenderer.invoke('ai:send', req),
    abort: (requestId) => ipcRenderer.invoke('ai:abort', requestId),
    run: (proposal) => ipcRenderer.invoke('ai:run', proposal),
    onEvent: (listener) => {
      const handler = (_e, data) => listener(data)
      ipcRenderer.on('ai:event', handler)
      return () => ipcRenderer.removeListener('ai:event', handler)
    },
    chats: {
      list: () => ipcRenderer.invoke('ai:chats:list'),
      get: (id) => ipcRenderer.invoke('ai:chats:get', id),
      save: (chat) => ipcRenderer.invoke('ai:chats:save', chat),
      remove: (id) => ipcRenderer.invoke('ai:chats:remove', id),
      removeAll: () => ipcRenderer.invoke('ai:chats:removeAll'),
    },
  },
  cleanName: (id) => ipcRenderer.invoke('files:cleanName', id),
  renameClean: (id) => ipcRenderer.invoke('files:rename', id),
  explainJob: (id) => ipcRenderer.invoke('jobs:explain', id),
  bgPreview: (p) => ipcRenderer.invoke('bgremove:preview', p),
  transcripts: {
    list: () => ipcRenderer.invoke('transcripts:list'),
    has: (p) => ipcRenderer.invoke('transcripts:has', p),
    search: (q) => ipcRenderer.invoke('transcripts:search', q),
    remove: (p) => ipcRenderer.invoke('transcripts:remove', p),
    make: (p) => ipcRenderer.invoke('transcripts:make', p),
    summary: (p) => ipcRenderer.invoke('transcripts:summary', p),
    chapters: (p) => ipcRenderer.invoke('transcripts:chapters', p),
    writeChapters: (p, chapters) => ipcRenderer.invoke('transcripts:writeChapters', p, chapters),
    ask: (requestId, p, question) => ipcRenderer.invoke('transcripts:ask', requestId, p, question),
  },
  grade: {
    looks: () => ipcRenderer.invoke('grade:looks'),
    auto: (p) => ipcRenderer.invoke('grade:auto', p),
    preview: (req) => ipcRenderer.invoke('grade:preview', req),
    match: (input, reference) => ipcRenderer.invoke('grade:match', input, reference),
    importLut: (file) => ipcRenderer.invoke('grade:importLut', file),
    aiLook: (req) => ipcRenderer.invoke('grade:aiLook', req),
  },
  beatsResult: (id) => ipcRenderer.invoke('beats:result', id),
  previewRestore: (req) => ipcRenderer.invoke('restore:preview', req),
  analyzeJumpCut: (req) => ipcRenderer.invoke('jumpcut:analyze', req),
  suggestSettings: (tool, filePath, opts) => ipcRenderer.invoke('auto:suggest', tool, filePath, opts ?? null),
  tagger: {
    identify: (filePath) => ipcRenderer.invoke('tagger:identify', filePath),
    listAudio: (folder) => ipcRenderer.invoke('tagger:listAudio', folder),
  },
  checkDemucs: () => ipcRenderer.invoke('system:checkDemucs'),
  checkBeats: () => ipcRenderer.invoke('system:checkBeats'),
  checkBgRemove: () => ipcRenderer.invoke('system:checkBgRemove'),
  checkLibreOffice: () => ipcRenderer.invoke('system:checkLibreOffice'),
  checkRealesrgan: () => ipcRenderer.invoke('system:checkRealesrgan'),
  checkRife: () => ipcRenderer.invoke('system:checkRife'),
  checkFasterWhisper: () => ipcRenderer.invoke('system:checkFasterWhisper'),
  plugins: {
    list: () => ipcRenderer.invoke('plugins:list'),
    enable: (id, approved) => ipcRenderer.invoke('plugins:enable', id, approved),
    disable: (id) => ipcRenderer.invoke('plugins:disable', id),
    remove: (id) => ipcRenderer.invoke('plugins:remove', id),
    rescan: () => ipcRenderer.invoke('plugins:rescan'),
    storeList: (force) => ipcRenderer.invoke('plugins:storeList', force === true),
    storeInstall: (id) => ipcRenderer.invoke('plugins:storeInstall', id),
    openFolder: () => ipcRenderer.invoke('plugins:openFolder'),
    call: (id, method, args) => ipcRenderer.invoke('plugins:call', id, method, args),
    onChanged: (listener) => {
      const handler = () => listener()
      ipcRenderer.on('plugins:changed', handler)
      return () => ipcRenderer.removeListener('plugins:changed', handler)
    },
  },
  mcp: {
    info: () => ipcRenderer.invoke('mcp:info'),
    resetToken: () => ipcRenderer.invoke('mcp:resetToken'),
  },
  queue: {
    state: () => ipcRenderer.invoke('queue:state'),
    setPaused: (paused) => ipcRenderer.invoke('queue:setPaused', paused),
    onState: (listener) => {
      const handler = (_e, s) => listener(s)
      ipcRenderer.on('queue:state', handler)
      return () => ipcRenderer.removeListener('queue:state', handler)
    },
  },
  dev: {
    setEnabled: (on) => ipcRenderer.invoke('dev:setEnabled', on),
    info: () => ipcRenderer.invoke('dev:info'),
    metrics: () => ipcRenderer.invoke('dev:metrics'),
    logs: () => ipcRenderer.invoke('dev:logs'),
    tasks: () => ipcRenderer.invoke('dev:tasks'),
    diagnostics: () => ipcRenderer.invoke('dev:diagnostics'),
    openUserData: () => ipcRenderer.invoke('dev:openUserData'),
    toggleDevTools: () => ipcRenderer.invoke('dev:toggleDevTools'),
    reloadUI: () => ipcRenderer.invoke('dev:reloadUI'),
    testNotification: () => ipcRenderer.invoke('dev:testNotification'),
    fakeJob: (fail) => ipcRenderer.invoke('dev:fakeJob', !!fail),
    clearEngineCache: () => ipcRenderer.invoke('dev:clearEngineCache'),
    ipc: () => ipcRenderer.invoke('dev:ipc'),
    settings: () => ipcRenderer.invoke('dev:settings'),
    showSettingsFile: () => ipcRenderer.invoke('dev:showSettingsFile'),
    jobChannels: () => ipcRenderer.invoke('dev:jobChannels'),
    startJob: (channel, req) => ipcRenderer.invoke('dev:startJob', channel, req),
    makeTestMedia: (kind) => ipcRenderer.invoke('dev:makeTestMedia', kind),
    loopLag: () => ipcRenderer.invoke('dev:loopLag'),
  },
  checkTorchEngine: () => ipcRenderer.invoke('system:checkTorchEngine'),
  probeMedia: (p) => ipcRenderer.invoke('media:probe', p),
  mediaFrame: (p, t, width) => ipcRenderer.invoke('media:frame', p, t, width),
  mediaThumbs: (p, duration, count) => ipcRenderer.invoke('media:thumbs', p, duration, count),
  installTool: (tool) => ipcRenderer.invoke('system:installTool', tool),
  cancelInstall: () => ipcRenderer.invoke('system:installCancel'),
  onInstallProgress: (listener) => {
    const handler = (_e, p) => listener(p)
    ipcRenderer.on('system:installProgress', handler)
    return () => ipcRenderer.removeListener('system:installProgress', handler)
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
  },
  subscriptions: {
    list: () => ipcRenderer.invoke('subs:list'),
    add: (input) => ipcRenderer.invoke('subs:add', input),
    remove: (id) => ipcRenderer.invoke('subs:remove', id),
    setEnabled: (id, enabled) => ipcRenderer.invoke('subs:setEnabled', id, enabled),
    checkNow: (id) => ipcRenderer.invoke('subs:checkNow', id),
    onChange: (listener) => {
      const handler = (_e, list) => listener(list)
      ipcRenderer.on('subs:changed', handler)
      return () => ipcRenderer.removeListener('subs:changed', handler)
    },
  },
  library: {
    exportHistory: () => ipcRenderer.invoke('library:export'),
    importHistory: () => ipcRenderer.invoke('library:import'),
    importApply: (entries, run) => ipcRenderer.invoke('library:importApply', entries, run),
  },
  login: {
    open: (url) => ipcRenderer.invoke('login:open', url),
    status: () => ipcRenderer.invoke('login:status'),
    clear: () => ipcRenderer.invoke('login:clear'),
    test: () => ipcRenderer.invoke('login:test'),
  },
  updates: {
    check: () => ipcRenderer.invoke('updates:check'),
    openRelease: (url) => ipcRenderer.invoke('updates:openRelease', url),
  },
  omarchy: {
    get: () => ipcRenderer.invoke('omarchy:get'),
    subscribe: (listener) => {
      const handler = (_e, theme) => listener(theme)
      ipcRenderer.on('omarchy:theme-changed', handler)
      return () => ipcRenderer.removeListener('omarchy:theme-changed', handler)
    },
  },
  tasks: {
    startDownload: (req) => ipcRenderer.invoke('tasks:start', req),
    startConvert: (req) => ipcRenderer.invoke('tasks:startConvert', req),
    startUpscale: (req) => ipcRenderer.invoke('tasks:startUpscale', req),
    startVideoUpscale: (req) => ipcRenderer.invoke('tasks:startVideoUpscale', req),
    startInterpolate: (req) => ipcRenderer.invoke('tasks:startInterpolate', req),
    startAudioAi: (req) => ipcRenderer.invoke('tasks:startAudioAi', req),
    startTrim: (req) => ipcRenderer.invoke('tasks:startTrim', req),
    startCompress: (req) => ipcRenderer.invoke('tasks:startCompress', req),
    startTag: (req) => ipcRenderer.invoke('tasks:startTag', req),
    fileOf: (id) => ipcRenderer.invoke('tasks:file', id),
    startGif: (req) => ipcRenderer.invoke('tasks:startGif', req),
    startJumpCut: (req) => ipcRenderer.invoke('tasks:startJumpCut', req),
    startRestore: (req) => ipcRenderer.invoke('tasks:startRestore', req),
    startBeatAnalyze: (req) => ipcRenderer.invoke('tasks:startBeatAnalyze', req),
    startBeatCut: (req) => ipcRenderer.invoke('tasks:startBeatCut', req),
    startBgRemove: (req) => ipcRenderer.invoke('tasks:startBgRemove', req),
    startGrade: (req) => ipcRenderer.invoke('tasks:startGrade', req),
    startSubtitles: (req) => ipcRenderer.invoke('tasks:startSubtitles', req),
    cancel: (taskId) => ipcRenderer.send('tasks:cancel', taskId),
    rerun: (taskId, opts) => ipcRenderer.invoke('tasks:rerun', taskId, opts),
    openFolder: (taskId) => ipcRenderer.invoke('tasks:openFolder', taskId),
    clearFinished: () => ipcRenderer.invoke('tasks:clearFinished'),
    remove: (ids) => ipcRenderer.invoke('tasks:remove', ids),
    list: () => ipcRenderer.invoke('tasks:list'),
    runNext: (taskId) => ipcRenderer.invoke('tasks:runNext', taskId),
    logs: (taskId) => ipcRenderer.invoke('tasks:logs', taskId),
    watchLog: (taskId, on) => ipcRenderer.invoke('tasks:logWatch', taskId, on),
    onLog: (listener) => {
      const handler = (_e, payload) => listener(payload)
      ipcRenderer.on('tasks:log', handler)
      return () => ipcRenderer.removeListener('tasks:log', handler)
    },
    onUpdate: (listener) => {
      const handler = (_e, update) => listener(update)
      ipcRenderer.on('tasks:update', handler)
      return () => ipcRenderer.removeListener('tasks:update', handler)
    },
    getDefaultDownloadDir: () => ipcRenderer.invoke('tasks:defaultDownloadDir'),
    probe: (req) => ipcRenderer.invoke('tasks:probe', req),
  },
})