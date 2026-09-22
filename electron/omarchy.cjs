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
 * Reads and watches the Omarchy Linux desktop's live theme, for the optional
 * "sync with Omarchy" UI theme (see src/themes/omarchySync.ts). Every Omarchy
 * theme resolves to this same stable state path, updated in place by
 * `omarchy theme set` — no hook installation needed, and this is a total
 * no-op (never throws) on any system that isn't Omarchy.
 */

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const STATE_DIR = path.join(os.homedir(), '.local', 'state', 'omarchy', 'current')
const NAME_FILE = path.join(STATE_DIR, 'theme.name')
const COLORS_FILE = path.join(STATE_DIR, 'theme', 'colors.toml')

/**
 * Minimal parser for Omarchy's colors.toml. Every line in that file is a
 * flat `key = "value"` (or occasionally `key = value`) with no nesting and
 * no arrays — a full TOML parser would be overkill for this one
 * machine-generated file, and pulling in a dependency isn't worth it either.
 */
function parseFlatToml(text) {
  const out = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*"?([^"\n]*?)"?\s*$/)
    if (!m) continue
    out[m[1]] = m[2].trim()
  }
  return out
}

/** Reads the currently active Omarchy theme, or null if unavailable/unreadable. */
function readOmarchyTheme() {
  try {
    const slug = fs.readFileSync(NAME_FILE, 'utf8').trim()
    const colors = parseFlatToml(fs.readFileSync(COLORS_FILE, 'utf8'))
    if (!colors.background || !colors.foreground || !colors.accent) return null
    return { slug, colors }
  } catch {
    return null
  }
}

/**
 * Watches Omarchy's live theme state and calls onChange(theme | null) on
 * every settled change. Returns an unsubscribe function; a no-op one when
 * Omarchy isn't installed at all, so callers never need to check first.
 */
function watchOmarchyTheme(onChange) {
  if (!fs.existsSync(STATE_DIR)) return () => {}

  let timer = null
  const emit = () => {
    clearTimeout(timer)
    // `omarchy theme set` stages into a sibling path and swaps it in, which
    // fires several watch events in quick succession — debounce so we read
    // the settled result once, not a half-written intermediate state.
    timer = setTimeout(() => onChange(readOmarchyTheme()), 150)
  }

  let watcher
  try {
    // recursive: true also catches an in-place rewrite of colors.toml
    // inside theme/, not just the top-level directory being swapped.
    watcher = fs.watch(STATE_DIR, { recursive: true }, emit)
  } catch {
    try {
      watcher = fs.watch(STATE_DIR, emit)
    } catch {
      return () => {}
    }
  }

  return () => {
    clearTimeout(timer)
    watcher.close()
  }
}

module.exports = { readOmarchyTheme, watchOmarchyTheme }
