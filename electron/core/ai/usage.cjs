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
 * Token use per provider and month, kept on this computer, with an optional monthly limit for cloud providers (cloud
 * models cost money; a local model is free, so it is counted but never limited). No Electron.
 */
const fs = require('node:fs')
const path = require('node:path')

const monthOf = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

/** @param {{ file: string, now?: () => Date }} deps */
function createUsage({ file, now = () => new Date() }) {
  let data = {}
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (j && typeof j === 'object') data = j
  } catch {
    /* none yet */
  }
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(data), { mode: 0o600 })
    fs.renameSync(`${file}.tmp`, file)
  }
  return {
    /** Adds one answer's tokens to this month under `provider` (a cloud provider id, or "local", "ollama"...). */
    record(provider, { input = 0, output = 0 } = {}) {
      const m = monthOf(now())
      const cur = ((data[m] ??= {})[provider] ??= { input: 0, output: 0, answers: 0 })
      cur.input += Math.max(0, Number(input) || 0)
      cur.output += Math.max(0, Number(output) || 0)
      cur.answers += 1
      for (const old of Object.keys(data).sort().slice(0, -12)) delete data[old] // a year of history is plenty
      save()
    },
    /** This month's numbers per provider: { anthropic: { input, output, answers } }. */
    month: (d = now()) => structuredClone(data[monthOf(d)] ?? {}),
    /** Tokens used this month by one provider (input plus output). */
    tokens(provider) {
      const u = data[monthOf(now())]?.[provider]
      return u ? u.input + u.output : 0
    },
  }
}

module.exports = { createUsage, monthOf }
