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

// Runs INSIDE the sandboxed iframe that hosts a plugin card (see electron/core/plugin_frame.cjs).
// Bundled with React by scripts/build-frame.mjs into frame.js. It talks to the app only by postMessage:
// the app answers `call` messages for this one plugin, so the card gets the same API it always had.
import { Component, createElement } from 'react'
import * as React from 'react'
import { createRoot } from 'react-dom/client'

window.OPNduck = Object.freeze({ React })

const send = (message) => window.parent.postMessage({ opnduckPlugin: 1, ...message }, '*')
const waiting = new Map()
let nextId = 1

function call(method, ...args) {
  return new Promise((resolve, reject) => {
    const id = nextId++
    waiting.set(id, { resolve, reject })
    send({ type: 'call', id, method, args })
  })
}

// Same shape as PluginApi in src/features/PluginFrame.tsx.
const api = {
  jobs: { start: (tool, args) => call('jobs.start', tool, args), list: () => call('jobs.list'), cancel: (id) => call('jobs.cancel', id) },
  files: { pick: (opts) => call('files.pick', opts ?? {}) },
  settings: { get: (key) => call('settings.get', key), set: (key, value) => call('settings.set', key, value) },
  notify: (opts) => call('notify', opts),
  rpc: { call: (name, arg) => call('rpc.call', name, arg) },
}

// For a selector plugin (manifest ui.slot): the app's tools and which one is open. Others see an empty list.
const appState = { features: [], selected: null }
const appListeners = new Set()
api.app = {
  features: () => appState.features,
  selected: () => appState.selected,
  select: (id) => send({ type: 'select', id: id ?? null }),
  // Stage plugins: how visible the open tool's real card is (0 hides it while the wheel spins, 1 shows it).
  setCardOpacity: (value) => send({ type: 'card-opacity', value }),
  subscribe: (fn) => (appListeners.add(fn), () => appListeners.delete(fn)),
}

class Boundary extends Component {
  state = { error: null }
  static getDerivedStateFromError(err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
  componentDidCatch(err) {
    send({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
  render() {
    return this.state.error === null ? this.props.children : null
  }
}

let root = null

async function start({ feature, entry, version, fill }) {
  try {
    if (fill) {
      for (const el of [document.documentElement, document.body, document.getElementById('root')]) el.style.height = '100%'
    }
    const url = new URL(entry, window.location.href)
    url.searchParams.set('v', String(version))
    const mod = await import(/* webpackIgnore: true */ url.href)
    if (typeof mod.default !== 'function') throw new Error('the UI entry must default-export a component')
    root ??= createRoot(document.getElementById('root'))
    root.render(createElement(Boundary, null, createElement(mod.default, { feature, api })))
    new ResizeObserver(() => send({ type: 'height', value: document.documentElement.scrollHeight })).observe(document.getElementById('root'))
    send({ type: 'height', value: document.documentElement.scrollHeight })
  } catch (err) {
    send({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}

window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return
  const m = event.data
  if (!m || m.opnduckPlugin !== 1) return
  if (m.type === 'init') void start(m)
  else if (m.type === 'app') {
    appState.features = Array.isArray(m.features) ? m.features : []
    appState.selected = typeof m.selected === 'string' ? m.selected : null
    for (const fn of [...appListeners]) fn()
  } else if (m.type === 'theme') {
    // The app's theme: the data-theme attribute and its inline colour variables, so the card follows the theme.
    const el = document.documentElement
    if (typeof m.dataTheme === 'string') el.setAttribute('data-theme', m.dataTheme)
    if (typeof m.style === 'string') el.setAttribute('style', m.style)
    else el.removeAttribute('style')
  } else if (m.type === 'result') {
    const p = waiting.get(m.id)
    if (!p) return
    waiting.delete(m.id)
    if (m.ok) p.resolve(m.value)
    else p.reject(new Error(String(m.error ?? 'Failed')))
  }
})

send({ type: 'ready' })
