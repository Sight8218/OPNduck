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
 * Runs inside one worker thread per plugin backend (started by plugins.cjs). Builds the `opnduck`
 * object the plugin sees: every method is a message to the host, which checks permissions.
 */
const { parentPort, workerData } = require('node:worker_threads')

let nextId = 1
const pending = new Map() // call id -> { resolve, reject }
const handlers = { tool: new Map(), command: new Map(), rpc: new Map() }
const eventHandlers = new Map() // event -> Set<fn>

function hostCall(method, ...args) {
  return new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    parentPort.postMessage({ type: 'call', id, method, args })
  })
}

const asError = (e) => Object.assign(new Error(e?.message ?? 'Failed'), { name: e?.name ?? 'Error' })
const wire = (err) => ({ name: err?.name ?? 'Error', message: String(err?.message ?? err) })

function handle(kind, hostMethod) {
  return (name, fn) => {
    if (typeof fn !== 'function') throw new TypeError('handler must be a function')
    handlers[kind].set(name, fn)
    return hostCall(hostMethod, name).catch((err) => {
      handlers[kind].delete(name)
      throw err
    })
  }
}

const opnduck = Object.freeze({
  id: workerData.id,
  version: workerData.version,
  log: (...args) => void hostCall('log', ...args).catch(() => {}),
  jobs: Object.freeze({ start: (name, args) => hostCall('jobs.start', name, args), list: () => hostCall('jobs.list'), cancel: (id) => hostCall('jobs.cancel', id) }),
  files: Object.freeze({
    read: async (p) => Buffer.from(await hostCall('files.read', p)),
    write: (p, data) => hostCall('files.write', p, data),
    pick: (opts) => hostCall('files.pick', opts),
  }),
  exec: Object.freeze({ run: (name, args, opts) => hostCall('exec.run', name, args, opts) }),
  net: Object.freeze({
    fetch: async (url, init) => {
      const r = await hostCall('net.fetch', url, init)
      const body = Buffer.from(r.body)
      return { status: r.status, headers: r.headers, body, text: () => body.toString('utf8'), json: () => JSON.parse(body.toString('utf8')) }
    },
  }),
  settings: Object.freeze({ get: (key) => hostCall('settings.get', key), set: (key, value) => hostCall('settings.set', key, value) }),
  notify: (opts) => hostCall('notify', opts),
  on(event, fn) {
    if (typeof fn !== 'function') throw new TypeError('handler must be a function')
    let set = eventHandlers.get(event)
    if (!set) {
      set = new Set()
      eventHandlers.set(event, set)
      hostCall('hooks.subscribe', event).catch((err) => {
        eventHandlers.delete(event)
        hostCall('log', `on("${event}") failed: ${err.message}`).catch(() => {})
      })
    }
    set.add(fn)
    return () => set.delete(fn)
  },
  tools: Object.freeze({ handle: handle('tool', 'tools.handle') }),
  commands: Object.freeze({ handle: handle('command', 'commands.handle') }),
  rpc: Object.freeze({ handle: handle('rpc', 'rpc.handle') }),
})

let plugin = null

parentPort.on('message', async (msg) => {
  if (msg.type === 'result') {
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.ok) p.resolve(msg.value)
    else p.reject(asError(msg.error))
  } else if (msg.type === 'invoke') {
    try {
      let value
      if (msg.kind === 'event') {
        for (const fn of eventHandlers.get(msg.name) ?? []) await fn(msg.args)
      } else {
        const fn = handlers[msg.kind]?.get(msg.name)
        if (!fn) throw new Error(`No handler for ${msg.kind} "${msg.name}"`)
        value = await fn(msg.args)
      }
      parentPort.postMessage({ type: 'invoke-result', id: msg.id, ok: true, value })
    } catch (err) {
      parentPort.postMessage({ type: 'invoke-result', id: msg.id, ok: false, error: wire(err) })
    }
  } else if (msg.type === 'stop') {
    try {
      await plugin?.deactivate?.()
    } catch {
      /* stopping anyway */
    }
    parentPort.postMessage({ type: 'stopped' })
  }
})

;(async () => {
  try {
    plugin = require(workerData.entry)
    if (typeof plugin.activate !== 'function') throw new Error('backend must export an activate(opnduck) function')
    await plugin.activate(opnduck)
    parentPort.postMessage({ type: 'ready' })
  } catch (err) {
    parentPort.postMessage({ type: 'failed', error: wire(err) })
  }
})()
