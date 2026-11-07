// Performance regression guard. Launches the packaged Linux build (release-build/linux-unpacked) a few
// times, records startup time (OPNDUCK_TRACE), idle RAM and bundle size, and compares them with
// scripts/perf-baseline.json. Exits 1 if any metric is more than 10% worse.
//   node scripts/perf-check.mjs            compare against the baseline
//   node scripts/perf-check.mjs --update   write the current numbers as the new baseline
// Needs `npm run dist:linux` first. Warm-cache numbers (a cold start needs root to drop the OS cache).
import { spawn, execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bin = path.join(root, 'release-build/linux-unpacked/opnduck-desktop')
const baselineFile = path.join(root, 'scripts/perf-baseline.json')
const RUNS = 3
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]

if (!existsSync(bin)) {
  console.error('Build the Linux package first: npm run dist:linux')
  process.exit(2)
}

/** Every process under `rootPid` (the app's own tree: main, zygote, renderer, GPU, utility, Python workers). */
function processTree(rootPid) {
  const rows = execSync('ps -eo pid=,ppid=,rss=,cputime=,args=').toString().trim().split('\n').map((l) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(l)
    return m && { pid: +m[1], ppid: +m[2], rssMB: +m[3] / 1024, cpu: m[4], args: m[5] }
  }).filter(Boolean)
  const keep = new Set([rootPid])
  for (let grew = true; grew; ) {
    grew = false
    for (const r of rows) if (!keep.has(r.pid) && keep.has(r.ppid)) (keep.add(r.pid), (grew = true))
  }
  return rows.filter((r) => keep.has(r.pid))
}
function kind(r, rootPid) {
  if (r.pid === rootPid) return 'main'
  const t = /--type=([\w-]+)/.exec(r.args)?.[1]
  if (t === 'renderer') return 'renderer'
  if (t === 'gpu-process') return 'gpu'
  if (t) return t === 'zygote' ? 'zygote' : 'utility'
  return /python/i.test(r.args) ? 'python' : 'other'
}
/** Seconds of CPU time a process has used so far (ps prints [dd-]hh:mm:ss). */
function cpuSeconds(t) {
  const [d, hms] = t.includes('-') ? t.split('-') : [0, t]
  const [h, m, sec] = hms.split(':').map(Number)
  return Number(d) * 86400 + h * 3600 + m * 60 + sec
}
function snapshot(rootPid) {
  const procs = processTree(rootPid)
  const byKind = {}
  for (const r of procs) byKind[kind(r, rootPid)] = (byKind[kind(r, rootPid)] ?? 0) + r.rssMB
  return { totalMB: procs.reduce((s, r) => s + r.rssMB, 0), byKind, cpuSec: procs.reduce((s, r) => s + cpuSeconds(r.cpu), 0), n: procs.length }
}
const rd = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]))

/** Calls a window method over the DevTools protocol (the app is started with a debugging port in perf runs only). */
async function cdpEval(port, expression) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
  const page = targets.find((t) => t.type === 'page')
  if (!page) throw new Error('no page target')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)))
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression } }))
  await new Promise((res) => ((ws.onmessage = res), setTimeout(res, 2000)))
  ws.close()
}

async function oneRun(port) {
  const ud = mkdtempSync(path.join(tmpdir(), 'opnduck-perf-'))
  // Tray mode on, so closing the window hides it (and later destroys it) instead of quitting.
  writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ runInTray: true }))
  const child = spawn(bin, [`--user-data-dir=${ud}`, `--remote-debugging-port=${port}`], { env: { ...process.env, OPNDUCK_TRACE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  child.stdout.on('data', (c) => (out += c))
  const t0 = Date.now()
  while (!/renderer did-finish-load (\d+)ms/.test(out) && Date.now() - t0 < 20000) await sleep(50)
  const loaded = Number(/renderer did-finish-load (\d+)ms/.exec(out)?.[1])
  await sleep(7000) // let it settle
  const idle = snapshot(child.pid)
  // Idle CPU: CPU seconds used over a 10 s window with the window open and nothing running.
  await sleep(10000)
  const idle2 = snapshot(child.pid)
  const cpuPct = ((idle2.cpuSec - idle.cpuSec) / 10) * 100
  // Tray idle: close the window (hides it into the tray), wait past the 60 s destroy delay if the app has one.
  let tray = null
  try {
    await cdpEval(port, 'window.opnduckHost?.window?.close?.()')
    await sleep(Number(process.env.PERF_TRAY_WAIT_MS ?? 70000))
    tray = snapshot(child.pid)
  } catch (err) {
    console.error('tray measurement skipped:', err.message)
  }
  child.kill()
  await sleep(1500)
  return { loaded, ramMB: idle2.totalMB, byKind: idle2.byKind, cpuPct, trayMB: tray?.totalMB, trayByKind: tray?.byKind }
}

const runs = []
for (let i = 0; i < RUNS; i++) runs.push(await oneRun(9300 + i))
const medOf = (k) => median(runs.map((r) => r[k]).filter((v) => v !== undefined))
console.log('per-process RAM (MB, last run):', rd(runs.at(-1).byKind))
if (runs.at(-1).trayByKind) console.log('per-process RAM in the tray (MB, last run):', rd(runs.at(-1).trayByKind))

const assets = path.join(root, 'dist/assets')
const mainJs = readdirSync(assets).filter((f) => /^index-.*\.js$/.test(f)).map((f) => statSync(path.join(assets, f)).size)
const current = {
  startupMs: medOf('loaded'),
  idleRamMB: Math.round(medOf('ramMB')),
  trayRamMB: runs.some((r) => r.trayMB !== undefined) ? Math.round(medOf('trayMB')) : null,
  idleCpuPct: Math.round(medOf('cpuPct') * 10) / 10,
  mainBundleKB: Math.round(Math.max(...mainJs) / 1024),
  installMB: Math.round(Number(execSync(`du -sm "${path.join(root, 'release-build/linux-unpacked')}" | cut -f1`).toString())),
}
console.log('current :', current)

if (process.argv.includes('--update') || !existsSync(baselineFile)) {
  writeFileSync(baselineFile, JSON.stringify(current, null, 2) + '\n')
  console.log('baseline written to scripts/perf-baseline.json')
  process.exit(0)
}
const base = JSON.parse(readFileSync(baselineFile, 'utf8'))
console.log('baseline:', base)
const worse = Object.keys(base).filter((k) => base[k] && current[k] > base[k] * 1.1)
if (worse.length) {
  console.error(`FAIL: more than 10% worse than the baseline: ${worse.join(', ')}`)
  process.exit(1)
}
console.log('OK: within 10% of the baseline')
