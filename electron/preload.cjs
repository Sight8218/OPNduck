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
  checkFfmpeg: () => ipcRenderer.invoke('system:checkFfmpeg'),
  checkLibreOffice: () => ipcRenderer.invoke('system:checkLibreOffice'),
  checkRealesrgan: () => ipcRenderer.invoke('system:checkRealesrgan'),
  checkRife: () => ipcRenderer.invoke('system:checkRife'),
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
    cancel: (taskId) => ipcRenderer.send('tasks:cancel', taskId),
    rerun: (taskId) => ipcRenderer.invoke('tasks:rerun', taskId),
    openFolder: (taskId) => ipcRenderer.invoke('tasks:openFolder', taskId),
    clearFinished: () => ipcRenderer.invoke('tasks:clearFinished'),
    list: () => ipcRenderer.invoke('tasks:list'),
    onUpdate: (listener) => {
      const handler = (_e, tasks) => listener(tasks)
      ipcRenderer.on('tasks:update', handler)
      return () => ipcRenderer.removeListener('tasks:update', handler)
    },
    getDefaultDownloadDir: () => ipcRenderer.invoke('tasks:defaultDownloadDir'),
    probe: (req) => ipcRenderer.invoke('tasks:probe', req),
  },
})