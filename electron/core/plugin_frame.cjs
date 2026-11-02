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
'use strict'

/**
 * The page a plugin card runs in. The card is loaded into a sandboxed iframe (no allow-same-origin, so
 * its origin is opaque and it cannot touch the app's window, storage or preload bridge). This file builds
 * that page and the rules it is served under; electron/main.cjs serves it and src/features/PluginFrame.tsx
 * embeds it. The only line from the card to the app is postMessage, answered by PluginFrame.
 */

const fs = require('node:fs')
const path = require('node:path')

/** The card page may load scripts, styles, images and fonts from the plugin's own origin; nothing can connect out. */
const FRAME_CSP = [
  "default-src 'none'",
  'script-src opnduck-plugin:',
  "style-src opnduck-plugin: 'unsafe-inline'",
  'img-src opnduck-plugin: data: blob:',
  'font-src opnduck-plugin: data:',
  'media-src opnduck-plugin: data: blob:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "object-src 'none'",
].join('; ')

/** Files of the app's own build the card page may load (its stylesheet and the fonts that sheet names). */
const APP_ASSET_TYPES = { '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff' }

/** The stylesheet file name (e.g. "index-abc.css") from the built dist/index.html, or '' (dev server, no build). */
function appCssName(distDir) {
  try {
    const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8')
    return /href="[^"]*\/assets\/([A-Za-z0-9._-]+\.css)"/.exec(html)?.[1] ?? ''
  } catch {
    return ''
  }
}

/** A file from dist/assets by plain name, only the types above. Returns { data, type } or throws. */
function appAsset(distDir, name) {
  const type = APP_ASSET_TYPES[path.extname(String(name)).toLowerCase()]
  if (!type || !/^[A-Za-z0-9._-]+$/.test(name) || name.startsWith('.')) throw new Error('Not served')
  return { data: fs.readFileSync(path.join(distDir, 'assets', name)), type }
}

/** The card page: the app's stylesheet (when known), then the bootstrap script. */
function frameHtml(cssName) {
  const css = cssName && /^[A-Za-z0-9._-]+$/.test(cssName) ? `<link rel="stylesheet" href="__app/${cssName}">` : ''
  return `<!doctype html><html><head><meta charset="utf-8">${css}<style>html,body{background:transparent!important;margin:0}</style><script type="module" src="__frame.js"></script></head><body><div id="root"></div></body></html>`
}

module.exports = { FRAME_CSP, APP_ASSET_TYPES, appCssName, appAsset, frameHtml }
