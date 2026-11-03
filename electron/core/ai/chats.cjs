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
 * Conversations, kept as one JSON file each under userData/chats/. Nothing here talks to a model; only the person's own
 * machine holds these files. No Electron.
 */
const fs = require('node:fs')
const path = require('node:path')

const ID = /^[0-9a-f-]{8,40}$/
const MAX_CHATS = 500
const MAX_BYTES = 4 * 1024 * 1024

function createChats({ dir }) {
  const file = (id) => {
    if (!ID.test(String(id))) throw new Error('Bad conversation id')
    return path.join(dir, `${id}.json`)
  }

  function list() {
    let names = []
    try {
      names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'))
    } catch {
      return []
    }
    return names
      .map((n) => {
        try {
          const c = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'))
          return { id: c.id, title: String(c.title ?? 'New chat').slice(0, 80), updatedAt: Number(c.updatedAt) || 0 }
        } catch {
          return null
        }
      })
      .filter((c) => c && ID.test(String(c.id)))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  function get(id) {
    try {
      return JSON.parse(fs.readFileSync(file(id), 'utf8'))
    } catch {
      return null
    }
  }

  /** Saves a conversation (a made-up id is refused, the size is capped, the oldest chats go past 500). */
  function save(chat) {
    if (!chat || typeof chat !== 'object' || !Array.isArray(chat.messages)) throw new Error('Not a conversation')
    const body = JSON.stringify({ id: chat.id, title: String(chat.title ?? 'New chat').slice(0, 80), updatedAt: Date.now(), messages: chat.messages })
    if (body.length > MAX_BYTES) throw new Error('This conversation is too long to save. Start a new one.')
    const f = file(chat.id)
    fs.mkdirSync(dir, { recursive: true })
    const tmp = `${f}.tmp`
    fs.writeFileSync(tmp, body, { mode: 0o600 })
    fs.renameSync(tmp, f)
    const all = list()
    for (const old of all.slice(MAX_CHATS)) fs.rmSync(file(old.id), { force: true })
    return true
  }

  function remove(id) {
    fs.rmSync(file(id), { force: true })
    return true
  }

  const removeAll = () => fs.rmSync(dir, { recursive: true, force: true })

  return { list, get, save, remove, removeAll }
}

module.exports = { createChats }
