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

async function oneRun() {
  const ud = mkdtempSync(path.join(tmpdir(), 'opnduck-perf-'))
  const child = spawn(bin, [`--user-data-dir=${ud}`], { env: { ...process.env, OPNDUCK_TRACE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  child.stdout.on('data', (c) => (out += c))
  const t0 = Date.now()
  while (!/renderer did-finish-load (\d+)ms/.test(out) && Date.now() - t0 < 20000) await sleep(50)
  const loaded = Number(/renderer did-finish-load (\d+)ms/.exec(out)?.[1])
  await sleep(7000) // let it settle
  const procs = execSync(`ps -eo rss,args | grep -F -- "--user-data-dir=${ud}" | grep -v grep || true`).toString().trim().split('\n').filter(Boolean)
  const ramMB = procs.reduce((s, l) => s + Number(l.trim().split(/\s+/)[0]), 0) / 1024
  child.kill()
  await sleep(1500)
  return { loaded, ramMB }
}

const runs = []
for (let i = 0; i < RUNS; i++) runs.push(await oneRun())

const assets = path.join(root, 'dist/assets')
const mainJs = readdirSync(assets).filter((f) => /^index-.*\.js$/.test(f)).map((f) => statSync(path.join(assets, f)).size)
const current = {
  startupMs: median(runs.map((r) => r.loaded)),
  idleRamMB: Math.round(median(runs.map((r) => r.ramMB))),
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
const worse = Object.keys(base).filter((k) => current[k] > base[k] * 1.1)
if (worse.length) {
  console.error(`FAIL: more than 10% worse than the baseline: ${worse.join(', ')}`)
  process.exit(1)
}
console.log('OK: within 10% of the baseline')
