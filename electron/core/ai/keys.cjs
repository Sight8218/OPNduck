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
 * The AI API keys, one per provider, sealed before they touch the disk (the desktop passes Electron's safeStorage; the
 * terminal app and the server pass nothing and get a file only this user can read). Never logged, never sent anywhere
 * except to the provider they belong to. No Electron.
 */
const fs = require('node:fs')
const path = require('node:path')

/**
 * @param {object} deps
 * @param {string} deps.file
 * @param {(text: string) => string} [deps.seal]
 * @param {(sealed: string) => string} [deps.unseal]
 */
function createKeys({ file, seal = (t) => `plain:${t}`, unseal = (s) => s.replace(/^plain:/, '') }) {
  let data = {}
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (j && typeof j === 'object') data = j
  } catch {
    /* none yet */
  }
  function save() {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 })
    fs.chmodSync(tmp, 0o600)
    fs.renameSync(tmp, file)
  }
  return {
    get(id) {
      try {
        return data[id] ? unseal(data[id]) : null
      } catch {
        return null
      }
    },
    set(id, key) {
      if (typeof id !== 'string' || !/^[a-z0-9-]{1,30}$/.test(id)) throw new Error('Unknown provider')
      const k = String(key ?? '').trim()
      if (k.length < 8 || k.length > 400 || /\s/.test(k)) throw new Error('That does not look like an API key')
      data[id] = seal(k)
      save()
    },
    remove(id) {
      delete data[id]
      save()
    },
    /** Which providers have a key (never the keys themselves). */
    has: () => Object.keys(data),
  }
}

module.exports = { createKeys }
