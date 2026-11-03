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
 * Smart scheduling for heavy jobs (conversions, GPU work, transcription): only inside a time window, not on battery,
 * not while the GPU is hot, only when the person has been away a while, and an action once the queue is empty.
 * Everything is off until switched on in Settings. No Electron: the platform object supplies battery state, idle time
 * and the power actions (see core/platform.cjs).
 */
const fs = require('node:fs')
const { spawn } = require('node:child_process')

const TICK_MS = 10000
const COUNTDOWN_S = 60
const COOL_MARGIN_C = 8

const minutesOf = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number)
  return h * 60 + m
}

/** Is `date` between `from` and `to` (HH:MM)? A window that ends before it starts runs over midnight; equal times mean always. */
function inWindow(date, from, to) {
  const now = date.getHours() * 60 + date.getMinutes()
  const a = minutesOf(from)
  const b = minutesOf(to)
  if (a === b) return true
  return a < b ? now >= a && now < b : now >= a || now < b
}

/**
 * Why a heavy job may not start right now ('' when it may). `env`: { now: Date, onBattery: boolean|null, idleSec: number|null, hot: boolean, temp: number|null }.
 * Unknown battery or idle state never blocks: a rule that cannot be checked is not applied.
 */
function blockReason(sc, env) {
  if (sc.window && !inWindow(env.now, sc.from, sc.to)) return `Waiting for ${sc.from}`
  if (sc.battery && env.onBattery === true) return 'Waiting for power (on battery)'
  if (sc.heat && env.hot) return `Cooling down${env.temp != null ? ` (${env.temp} °C)` : ''}`
  if (sc.idle && env.idleSec != null && env.idleSec < sc.idleMinutes * 60) return 'Waiting until you are away'
  return ''
}

/** The hot flag with a gap between pausing and resuming, so a GPU hovering at the limit does not flap. */
function nextHot(wasHot, temp, maxC) {
  if (temp == null) return wasHot
  if (temp >= maxC) return true
  if (temp <= maxC - COOL_MARGIN_C) return false
  return wasHot
}

/** GPU temperature in °C from nvidia-smi, or the first AMD/Intel hwmon sensor; null when neither answers. */
function readGpuTemp() {
  return new Promise((resolve) => {
    let out = ''
    let child
    try {
      child = spawn('nvidia-smi', ['--query-gpu=temperature.gpu', '--format=csv,noheader,nounits'])
    } catch {
      return resolve(sysfsTemp())
    }
    child.stdout.on('data', (c) => (out += c))
    child.on('error', () => resolve(sysfsTemp()))
    child.on('close', () => {
      const t = Math.max(...out.split('\n').map((l) => Number.parseInt(l, 10)).filter(Number.isFinite))
      resolve(Number.isFinite(t) ? t : sysfsTemp())
    })
  })
}

function sysfsTemp() {
  try {
    for (const card of fs.readdirSync('/sys/class/drm').filter((n) => /^card\d+$/.test(n))) {
      const hw = `/sys/class/drm/${card}/device/hwmon`
      for (const h of fs.existsSync(hw) ? fs.readdirSync(hw) : []) {
        const t = Number.parseInt(fs.readFileSync(`${hw}/${h}/temp1_input`, 'utf8'), 10)
        if (Number.isFinite(t)) return Math.round(t / 1000)
      }
    }
  } catch {
    /* no sensor */
  }
  return null
}

/**
 * @param {object} deps
 * @param {object} deps.engine  the task engine
 * @param {object} deps.platform
 * @param {() => object} deps.getSettings
 * @param {() => Promise<number|null>} [deps.readTemp]
 * @param {() => Date} [deps.now]
 */
function createSchedule({ engine, platform, getSettings, readTemp = readGpuTemp, now = () => new Date() }) {
  const { tasks, allPools, pools } = engine
  const env = { hot: false, temp: null }
  let timer = null
  let lastReason = ''
  let sawWork = false
  let countdown = null // { action, endsAt, timer }

  const settings = () => getSettings().schedule

  const environment = () => ({
    now: now(),
    onBattery: platform.isOnBattery?.() ?? null,
    idleSec: platform.idleSeconds?.() ?? null,
    hot: env.hot,
    temp: env.temp,
  })

  /** The gate the task engine asks before starting a job in `pool`. */
  function gate(pool) {
    const sc = settings()
    if (!pool.heavy && !(sc.downloads && pool === pools.downloadPool)) return ''
    return blockReason(sc, environment())
  }

  const running = (pool) => [...tasks.values()].filter((e) => e.pool === pool && e.state.status === 'running')

  function signalAll(signal) {
    if (process.platform === 'win32') return // no suspend on Windows: running jobs finish, new ones wait
    for (const e of running(pools.gpuPool)) {
      const pid = e.child?.pid
      if (!pid) continue
      try {
        process.kill(e.killGroup ? -pid : pid, signal)
      } catch {
        /* it just ended */
      }
    }
  }

  function markWaiting(reasonOf) {
    for (const e of tasks.values()) {
      if (e.state.status !== 'queued' || !e.pool) continue
      const why = reasonOf(e.pool)
      if ((e.state.waiting ?? '') !== why) engine.updateTask(e.state.id, { waiting: why || null })
    }
  }

  async function tick() {
    const sc = settings()
    // Heat: only looked at while a GPU job runs (or while paused, to know when to resume).
    if (sc.heat && (running(pools.gpuPool).length > 0 || env.hot)) {
      env.temp = await readTemp()
      const hot = nextHot(env.hot, env.temp, sc.maxC)
      if (hot !== env.hot) {
        env.hot = hot
        signalAll(hot ? 'SIGSTOP' : 'SIGCONT')
        for (const e of running(pools.gpuPool)) engine.updateTask(e.state.id, { waiting: hot ? `Cooling down (${env.temp} °C)` : null })
      }
    } else if (env.hot) {
      env.hot = false
      env.temp = null
    }
    markWaiting(gate)
    const reason = [...allPools].map((p) => gate(p)).find(Boolean) ?? ''
    if (reason !== lastReason) {
      lastReason = reason
      allPools.forEach((p) => p.drain())
      platform.emit('schedule:changed', status())
    }
    finishCheck(sc)
  }

  /** When the queue has emptied after real work, do what Settings says. */
  function finishCheck(sc) {
    const busy = [...tasks.values()].some((e) => e.state.status === 'queued' || e.state.status === 'running')
    if (busy) {
      sawWork = true
      if (countdown && sc.whenDone === 'nothing') cancelCountdown()
      return
    }
    if (!sawWork || sc.whenDone === 'nothing') return
    sawWork = false
    if (sc.whenDone === 'notify') return void platform.notify?.({ title: 'OPNduck: the queue is empty', body: 'Every job has finished.' })
    // Sleeping or shutting down only ever happens with a window that can show the countdown, and after the person confirmed it.
    if (!sc.powerConfirmed || !platform.canCountdown?.()) return void platform.notify?.({ title: 'OPNduck: the queue is empty', body: 'Every job has finished.' })
    startCountdown(sc.whenDone)
  }

  function startCountdown(action) {
    if (countdown) return
    const endsAt = Date.now() + COUNTDOWN_S * 1000
    countdown = { action, endsAt, timer: setTimeout(() => ((countdown = null), platform.systemAction?.(action)), COUNTDOWN_S * 1000) }
    countdown.timer.unref?.()
    platform.emit('queue:countdown', { action, seconds: COUNTDOWN_S, endsAt })
  }

  function cancelCountdown() {
    if (!countdown) return false
    clearTimeout(countdown.timer)
    countdown = null
    platform.emit('queue:countdown', null)
    return true
  }

  const status = () => ({ reason: lastReason, hot: env.hot, temp: env.temp, countdown: countdown ? { action: countdown.action, endsAt: countdown.endsAt } : null })

  function start() {
    if (timer) return
    engine.setGate(gate)
    timer = setInterval(() => void tick().catch(() => {}), TICK_MS)
    timer.unref?.()
  }

  function stop() {
    if (timer) clearInterval(timer)
    timer = null
    cancelCountdown()
    if (env.hot) signalAll('SIGCONT') // never leave a job frozen
    engine.setGate(() => '')
  }

  return { start, stop, tick, gate, status, cancelCountdown }
}

module.exports = { createSchedule, inWindow, blockReason, nextHot, readGpuTemp, COUNTDOWN_S }
