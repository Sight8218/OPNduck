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
 * opnduck-server: the OPNduck engine without a window, for a home server, NAS or container. It runs the same job core
 * as the desktop app and the terminal app, and offers it to paired devices over the Engine API (engine-api/).
 *
 *   opnduck-server               start the server
 *   opnduck-server pair          print a one-time pair link (and a QR code) for a new device
 *   opnduck-server devices       list paired devices        devices revoke <id>   remove one
 *   opnduck-server send-link     print the link for "Send to OPNduck" (phone page, extension)
 */
const fs = require('node:fs')
const path = require('node:path')
const pkg = require('../package.json')
const { loadConfig, reachableUrls } = require('./config.cjs')
const { createDevices } = require('../engine-api/devices.cjs')
const { createAiShare } = require('../engine-api/ai_share.cjs')
const { createUploads } = require('../engine-api/uploads.cjs')
const { createV1 } = require('../engine-api/v1.cjs')
const { createEngineApi } = require('../engine-api/server.cjs')
const { createInfo } = require('../engine-api/info.cjs')
const { buildEnginePairLink } = require('../engine-api/pairlink.cjs')

const HELP = `opnduck-server ${pkg.version}: the OPNduck engine on another machine.

  opnduck-server                 start the server
  opnduck-server pair            a one-time pair link and QR code for a new device (valid 5 minutes)
                                 add --admin for a device that may see every job and manage the other devices
  opnduck-server devices         the paired devices
  opnduck-server devices revoke <id>
  opnduck-server send-link       the link for Send to OPNduck (phone page, browser extension)
  opnduck-server --version

Settings come from environment variables (or config.json in the data folder):
  OPNDUCK_DATA            data folder (default /data in a container, else ~/.local/share/opnduck-server)
  OPNDUCK_OUTPUT          where results are saved (default <data>/output)
  OPNDUCK_PORT            47821
  OPNDUCK_BIND            127.0.0.1, a Tailscale address, or 0.0.0.0 (default 127.0.0.1)
  OPNDUCK_PUBLIC_URL      the address devices should use, if it is not the bind address (https://server:47821)
  OPNDUCK_NAME            the name devices see (default: this machine's name)
  OPNDUCK_MAX_UPLOAD_GB   largest upload accepted (default 8)
  OPNDUCK_RETENTION_HOURS uploads and results older than this are deleted (default 48)
  OPNDUCK_RELAY           1 to also receive links through the ntfy relay`

function paths(cfg) {
  return {
    devices: path.join(cfg.data, 'devices.json'),
    codes: path.join(cfg.data, 'pair-codes.json'),
    uploads: path.join(cfg.data, 'uploads'),
    remote: path.join(cfg.data, 'remote.json'),
  }
}

/** Prints a pair link with its QR code, for the first address that devices can reach. */
async function printPairLink(cfg, code) {
  const urls = reachableUrls(cfg)
  const link = buildEnginePairLink({ baseUrl: urls[0], code, name: cfg.name })
  const QRCode = require('qrcode')
  console.log(await QRCode.toString(link, { type: 'terminal', small: true }))
  console.log(link)
  if (urls.length > 1) console.log(`\nThe link uses ${urls[0]}. Other addresses this server answers on: ${urls.slice(1).join(', ')}`)
  if (new URL(urls[0]).hostname === '127.0.0.1') console.log('\nThis address only works on this machine. Set OPNDUCK_BIND (or OPNDUCK_PUBLIC_URL) so other devices can reach it.')
  console.log('\nThe code works once and expires in 5 minutes. Run "opnduck-server pair" for another.')
}

/** Deletes finished results (and their history rows) older than the retention time, and expired uploads. */
function sweepOld(core, uploads, cfg) {
  uploads.sweep()
  const limit = Date.now() - cfg.retentionHours * 3600 * 1000
  const ids = []
  for (const [id, entry] of core.engine.tasks) {
    const f = entry.finalPath
    if (entry.state.status !== 'done' || !f || !path.resolve(f).startsWith(cfg.output + path.sep)) continue
    try {
      if (fs.statSync(f).mtimeMs < limit) {
        fs.rmSync(f, { force: true })
        ids.push(id)
      }
    } catch {
      ids.push(id) // the file is already gone
    }
  }
  if (ids.length) core.engine.removeTasks(ids)
}

async function serve(cfg) {
  const { createCore } = require('../electron/core/index.cjs')
  const { createNodePlatform } = require('../electron/core/platform.cjs')
  const { createRemoteInbox } = require('../electron/core/remote/inbox.cjs')
  const { createNtfyRelay } = require('../electron/core/remote/ntfy.cjs')
  const p = paths(cfg)
  fs.mkdirSync(cfg.output, { recursive: true })
  const here = __dirname
  const platform = createNodePlatform({ version: pkg.version, scriptsDir: here })
  platform.paths = { userData: path.join(cfg.data, 'app'), downloads: cfg.output, documents: cfg.data }
  platform.notify = () => false
  platform.canNotify = () => false
  const core = createCore({ platform, safeMode: true, pluginWorkerFile: path.join(here, 'plugin_worker.cjs') })
  core.engine.loadHistory()
  core.engine.applyQueueLimits()
  const { startHandlers, tasks } = core.engine

  // Links sent through /v1/send or the relay are downloaded at once: nobody is at a window to click "Download".
  core.settings.setSettings({ remoteEnabled: true, remoteMode: 'auto', remoteRelay: cfg.relay })
  const inbox = createRemoteInbox({
    file: p.remote,
    startDownload: async (req, via) => {
      const id = await startHandlers.get('tasks:start')(null, req)
      const entry = tasks.get(id)
      if (entry) entry.state.source = 'link'
      console.log(`remote: started a download from a link (${via})`)
      return id
    },
    notify: () => {},
    onChange: () => {},
    getSettings: core.settings.getSettings,
    getRecipe: (id) => core.recipes.get(id),
    runRecipe: (id, input) => core.recipes.run(id, input),
  })
  const relay = createNtfyRelay({
    inbox,
    getConfig: () => ({ enabled: cfg.relay, ...inbox.relay.get() }),
    lastId: inbox.relay.lastId,
    onStatus: () => {},
  })

  const devices = createDevices({ file: p.devices, codesFile: p.codes })
  const uploads = createUploads({ dir: p.uploads, maxBytes: cfg.maxUploadGB * 1024 ** 3, retentionMs: cfg.retentionHours * 3600 * 1000 })
  const v1 = createV1({ engine: core.engine, platform, devices, uploads, recipes: core.recipes, ai: createAiShare({ ai: core.ai, llama: core.llama, getSettings: core.settings.getSettings }), name: () => cfg.name, version: pkg.version, info: createInfo({ outputDir: () => path.join(cfg.output, 'OPNduck'), ytdlpCommand: () => core.ctx.ytdlpCommand?.() ?? 'yt-dlp' }), log: (l) => console.log(l) })
  const api = createEngineApi({ inbox, name: () => cfg.name, v1, log: (l) => console.log(l) })
  const st = await api.start({ mode: 'address', address: cfg.bind, port: cfg.port })
  if (!st.running) {
    console.error(`Could not start: ${st.error || 'nothing to listen on'}`)
    process.exit(1)
  }
  relay.apply()
  sweepOld(core, uploads, cfg)
  const timer = setInterval(() => sweepOld(core, uploads, cfg), 3600 * 1000)
  timer.unref()

  console.log(`OPNduck Server ${pkg.version} "${cfg.name}" listening on ${cfg.bind}:${st.port}`)
  console.log(`Data: ${cfg.data}   Results: ${path.join(cfg.output, 'OPNduck')}   Results and uploads are kept ${cfg.retentionHours} hours`)
  if (devices.list().length === 0) {
    console.log('\nNo device is paired yet. Scan this on the device (or paste it into OPNduck > Settings > Servers):\n')
    await printPairLink({ ...cfg, port: st.port }, devices.newPairCode('desktop')) // the first device is the owner
  }
  const stop = async () => {
    console.log('Stopping…')
    clearInterval(timer)
    await api.stop()
    relay.stop?.()
    core.shutdown()
    setTimeout(() => process.exit(0), 200).unref()
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

async function main(argv) {
  const [cmd, sub, arg] = argv
  if (cmd === '-h' || cmd === '--help' || cmd === 'help') return console.log(HELP)
  if (cmd === '-v' || cmd === '--version') return console.log(pkg.version)
  const cfg = loadConfig()
  fs.mkdirSync(cfg.data, { recursive: true, mode: 0o700 })
  const p = paths(cfg)
  if (cmd === undefined || cmd === 'serve') return serve(cfg)
  if (cmd === 'pair') return printPairLink(cfg, createDevices({ file: p.devices, codesFile: p.codes }).newPairCode(argv.includes('--admin') ? 'desktop' : 'phone'))
  if (cmd === 'devices') {
    const devices = createDevices({ file: p.devices, codesFile: p.codes })
    if (sub === 'revoke') {
      if (!arg) throw new Error('Usage: opnduck-server devices revoke <id>')
      console.log(devices.revoke(arg) ? 'Removed. That device can no longer use this server.' : 'No device has that id.')
      return
    }
    const list = devices.list()
    if (!list.length) return console.log('No devices are paired. Run "opnduck-server pair".')
    for (const d of list) console.log(`${d.id}  ${d.kind.padEnd(9)} ${d.name}  (paired ${new Date(d.createdAt).toISOString().slice(0, 10)})`)
    return
  }
  if (cmd === 'send-link') {
    const { createRemoteInbox } = require('../electron/core/remote/inbox.cjs')
    const { buildPairLink } = require('../electron/core/remote/envelope.cjs')
    const inbox = createRemoteInbox({ file: p.remote, startDownload: async () => '', notify: () => {}, onChange: () => {}, getSettings: () => ({}) })
    const direct = reachableUrls(cfg)[0]
    const link = buildPairLink({ secret: inbox.secret(), relay: inbox.relay.get().server || 'https://ntfy.sh', relayToken: inbox.relay.get().token, direct, name: cfg.name })
    console.log(await require('qrcode').toString(link, { type: 'terminal', small: true }))
    console.log(link)
    return
  }
  throw new Error(`Unknown command "${cmd}". Try: opnduck-server --help`)
}

main(process.argv.slice(2)).catch((err) => {
  console.error(err.message)
  process.exit(1)
})
