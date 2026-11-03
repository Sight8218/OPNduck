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

/** The Electron implementation of the platform interface (see core/platform.cjs). */
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { app, BrowserWindow, Notification, shell, powerMonitor } = require('electron')
const { linuxOnBattery, systemActionCommand } = require('./core/platform.cjs')

const windows = () => BrowserWindow.getAllWindows()
const bus = new EventEmitter()

module.exports = {
  paths: {
    get userData() {
      return app.getPath('userData')
    },
    get downloads() {
      return app.getPath('downloads')
    },
    get documents() {
      return app.getPath('documents')
    },
  },
  scriptPath: (name) => path.join(__dirname, name),
  get version() {
    return app.getVersion()
  },
  get isPackaged() {
    return app.isPackaged
  },
  emit(channel, payload) {
    for (const win of windows()) win.webContents.send(channel, payload)
    bus.emit(channel, payload)
  },
  /** Listen to events in the main process too (the engine API follows 'tasks:update'); returns an unsubscribe function. */
  on(channel, fn) {
    bus.on(channel, fn)
    return () => bus.off(channel, fn)
  },
  isOnBattery: () => {
    try {
      return powerMonitor.isOnBatteryPower()
    } catch {
      return process.platform === 'linux' ? linuxOnBattery() : null
    }
  },
  idleSeconds: () => {
    try {
      return powerMonitor.getSystemIdleTime()
    } catch {
      return null
    }
  },
  canCountdown: () => windows().length > 0, // the window shows the 60 s countdown with a Cancel button
  systemAction(kind) {
    const [cmd, args] = systemActionCommand(kind)
    const child = require('node:child_process').spawn(cmd, args, { stdio: 'ignore', detached: true })
    child.on('error', () => {})
    child.unref()
  },
  canNotify: () => Notification.isSupported(),
  /** Shows a notification; `actions` are button labels and `onAction` runs when one is pressed. */
  notify({ title, body, actions, onAction, onClick }) {
    if (!Notification.isSupported()) return false
    const note = new Notification({ title, body, ...(actions?.length ? { actions: actions.map((text) => ({ type: 'button', text })) } : {}) })
    if (onAction) note.on('action', onAction)
    if (onClick) note.on('click', onClick)
    note.show()
    return true
  },
  /** Overall job progress on the taskbar/dock icon: 0..1, or -1 to clear. */
  setProgress(value) {
    for (const win of windows()) {
      try {
        win.setProgressBar(value)
      } catch {
        /* no taskbar integration here */
      }
    }
  },
  isFocused: () => windows().some((w) => w.isVisible() && w.isFocused()),
  openPath: (p) => shell.openPath(p),
  showInFolder: (p) => shell.showItemInFolder(p),
  openExternal: (url) => shell.openExternal(url),
}
