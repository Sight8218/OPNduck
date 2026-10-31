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

/**
 * The platform interface: everything the job code needs from the operating system or the UI
 * shell, so it never imports Electron. `createNodePlatform()` is the plain-Node implementation
 * (used by the terminal app); electron/platform_electron.cjs is the Electron one.
 *
 *   paths.userData / downloads / documents   folders (strings)
 *   version, isPackaged                      the app's version and whether it runs from a package
 *   emit(channel, payload)                   push an event to every UI (windows, or the TUI)
 *   canNotify() / notify({ title, body, actions, onAction, onClick })
 *   setProgress(value)                       overall job progress 0..1 (or -1) for a taskbar icon; optional
 *   isFocused()                              true while the user is looking at the app
 *   openPath(p) / showInFolder(p) / openExternal(url)
 */
const { EventEmitter } = require('node:events')
const { spawn } = require('node:child_process')
const os = require('node:os')
const path = require('node:path')

const APP_DIR = 'opnduck-desktop' // same folder name Electron derives from package.json

function userDataDir() {
  const home = os.homedir()
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), APP_DIR)
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', APP_DIR)
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), APP_DIR)
}

function detached(cmd, args) {
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
    child.on('error', () => {})
    child.unref()
  } catch {
    /* no opener on this system */
  }
}

/** @param {{ version?: string, isPackaged?: boolean }} [opts] */
function createNodePlatform(opts = {}) {
  const bus = new EventEmitter()
  const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '']] : process.platform === 'darwin' ? ['open', []] : ['xdg-open', []]
  const open = (target) => detached(opener[0], [...opener[1], target])
  return {
    paths: {
      userData: userDataDir(),
      downloads: path.join(os.homedir(), 'Downloads'),
      documents: path.join(os.homedir(), 'Documents'),
    },
    version: opts.version ?? '0.0.0',
    isPackaged: opts.isPackaged ?? false,
    /** Listen for events sent with emit(); returns an unsubscribe function. */
    on(channel, fn) {
      bus.on(channel, fn)
      return () => bus.off(channel, fn)
    },
    emit: (channel, payload) => void bus.emit(channel, payload),
    canNotify: () => true,
    notify({ title, body, onClick }) {
      process.stderr.write('\x07') // terminal bell
      if (process.platform === 'linux') detached('notify-send', [title, body ?? ''])
      void onClick
      return true
    },
    isFocused: () => false,
    openPath: open,
    showInFolder: (p) => open(path.dirname(p)),
    openExternal: open,
  }
}

module.exports = { createNodePlatform, userDataDir }
