// Dev launcher: `npm run desktop:dev`. One OPNduck dev session at a time, with live changes everywhere.
//  - Starting it again first stops the previous session (its Vite and Electron), instead of piling up windows.
//  - Frontend edits hot-reload through Vite as usual.
//  - Backend edits (electron/*.cjs, *.py) restart Electron automatically.
//  - Closing the app or pressing Ctrl+C stops everything this launcher started.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, watch, writeFileSync, unlinkSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pidFile = path.join(root, '.dev-session.pid')
const bin = (name) => path.join(root, 'node_modules', '.bin', name)
// The real Electron binary (not the npm wrapper script, whose children survive when it is killed).
const electronBinary = createRequire(import.meta.url)('electron')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Stops the previous launcher (it shuts down its own Vite and Electron), checking the pid really is ours. */
async function stopPrevious() {
  if (!existsSync(pidFile)) return
  const old = Number(readFileSync(pidFile, 'utf8').trim())
  if (!old || old === process.pid || !alive(old)) return
  let ours = false
  try {
    ours = readFileSync(`/proc/${old}/cmdline`, 'utf8').includes('scripts/dev.mjs')
  } catch {
    ours = process.platform === 'win32' // no /proc: trust the pid file
  }
  if (!ours) return
  console.log(`[dev] stopping the previous session (pid ${old})`)
  process.kill(old, 'SIGTERM')
  for (let i = 0; i < 40 && alive(old); i++) await sleep(100)
  if (alive(old)) process.kill(old, 'SIGKILL')
}

const portOpen = (port) =>
  new Promise((resolve) => {
    const s = net.connect(port, 'localhost')
    s.on('connect', () => (s.destroy(), resolve(true)))
    s.on('error', () => resolve(false))
  })

await stopPrevious()
writeFileSync(pidFile, String(process.pid))

let vite = null
let electron = null
let stopping = false

function shutdown(code = 0) {
  if (stopping) return
  stopping = true
  for (const c of [electron, vite]) {
    try {
      c?.kill('SIGTERM')
    } catch {
      /* already gone */
    }
  }
  try {
    unlinkSync(pidFile)
  } catch {
    /* fine */
  }
  setTimeout(() => process.exit(code), 400)
}
process.on('SIGTERM', () => shutdown(0))
process.on('SIGINT', () => shutdown(0))
process.on('SIGHUP', () => shutdown(0))

// Vite: reuse one that is already serving (e.g. started by hand), otherwise start it.
if (!(await portOpen(1420))) {
  vite = spawn(bin('vite'), [], { cwd: root, stdio: 'inherit' })
  vite.on('exit', () => !stopping && shutdown(1))
}
for (let i = 0; i < 300 && !(await portOpen(1420)); i++) await sleep(100)
if (!(await portOpen(1420))) {
  console.error('[dev] Vite did not start on :1420')
  shutdown(1)
}

let restarting = false
function startElectron() {
  electron = spawn(electronBinary, ['.', ...(process.env.OPNDUCK_ELECTRON_ARGS?.split(' ').filter(Boolean) ?? [])], { cwd: root, stdio: 'inherit' })
  const mine = electron
  electron.on('exit', (code) => {
    if (stopping || restarting) return
    if (mine === electron) {
      console.log(`[dev] the app closed (code ${code}); stopping`)
      shutdown(0)
    }
  })
}
startElectron()

// Backend changes restart Electron (the renderer already hot-reloads through Vite).
let timer = null
watch(path.join(root, 'electron'), { recursive: true }, (_event, file) => {
  if (!file || !/\.(cjs|js|py|png)$/.test(String(file))) return
  clearTimeout(timer)
  timer = setTimeout(async () => {
    if (stopping) return
    console.log(`[dev] ${file} changed: restarting the app`)
    restarting = true
    const old = electron
    old.kill('SIGTERM')
    for (let i = 0; i < 40 && old.exitCode === null; i++) await sleep(100)
    if (old.exitCode === null) old.kill('SIGKILL')
    restarting = false
    startElectron()
  }, 400)
})
console.log('[dev] ready: frontend hot-reloads; backend changes restart the app')
