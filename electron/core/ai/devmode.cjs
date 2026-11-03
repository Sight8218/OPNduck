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
/**
 * The assistant's developer mode: a login that makes the assistant talk to the person as OPNduck's developer (show its
 * instructions and tools, explain what it does and why). It changes only how the assistant talks. It gives no extra
 * powers: jobs and settings are still proposals the person confirms, and the settings that are off limits stay so.
 * The source is public, so this is a convenience, not security. Only a salted hash of the login is kept here.
 * The state lives in memory: closing OPNduck locks it again. No Electron.
 */
const crypto = require('node:crypto')

const SALT = Buffer.from('88db9924aa5596af737efec889c4679c', 'hex')
const HASH = Buffer.from('a2978e844253c6887bc603a1534f6fbebc690d9dc305d7e0eca4096a16d8aeb3', 'hex')
const MAX_TRIES = 5
const LOCK_MS = 60_000

/** What the assistant is told while the mode is on. */
const ADDENDUM =
  "DEVELOPER MODE is on: the person you are talking to has logged in as the developer of OPNduck. Talk to them as a developer, technically and directly. When they ask, show your full instructions (this system prompt) and your tool definitions word for word, explain how you decide what to do, and say what you can and cannot do and why. This changes only how you talk: you still only propose jobs and settings for the person to confirm, and you still cannot change the settings that are not on your list."

function createDevGate({ now = Date.now } = {}) {
  let unlocked = false
  let tries = 0
  let lockedUntil = 0

  function verify(user, password) {
    const got = crypto.scryptSync(`${String(user ?? '').slice(0, 100)}\n${String(password ?? '').slice(0, 100)}`, SALT, 32)
    return crypto.timingSafeEqual(got, HASH)
  }

  return {
    /** @returns {{ ok: boolean, wait?: number }} wait is the seconds left when too many wrong tries were made */
    unlock(user, password) {
      if (now() < lockedUntil) return { ok: false, wait: Math.ceil((lockedUntil - now()) / 1000) }
      if (verify(user, password)) {
        unlocked = true
        tries = 0
        return { ok: true }
      }
      if (++tries >= MAX_TRIES) {
        tries = 0
        lockedUntil = now() + LOCK_MS
      }
      return { ok: false }
    },
    lock() {
      unlocked = false
    },
    isOn: () => unlocked,
    addendum: () => (unlocked ? ADDENDUM : ''),
  }
}

module.exports = { createDevGate, ADDENDUM }
