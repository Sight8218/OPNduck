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
// Zips extension/ for each browser (Chrome and Firefox read slightly different manifests).
// Run: npm run build:extension   ->   dist-extension/opnduck-extension-{chrome,firefox}-<version>.zip
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = path.join(root, 'extension')
const out = path.join(root, 'dist-extension')

/** The manifest for one browser: Chrome runs a service worker (and warns about `scripts`/gecko keys), Firefox runs background scripts. */
export function manifestFor(manifest, browser) {
  const m = structuredClone(manifest)
  if (browser === 'chrome') {
    delete m.browser_specific_settings
    delete m.background.scripts
  } else {
    delete m.background.service_worker
  }
  return m
}

const files = (dir, base = dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name)
    return e.isDirectory() ? files(full, base) : [path.relative(base, full).split(path.sep).join('/')]
  })

/** A minimal zip writer (deflate, no extras): enough for a browser extension. */
export function zip(entries) {
  const local = []
  const central = []
  let offset = 0
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name)
    const deflated = zlib.deflateRawSync(data)
    const crc = zlib.crc32(data)
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0)
    head.writeUInt16LE(20, 4)
    head.writeUInt16LE(0x0800, 6) // UTF-8 names
    head.writeUInt16LE(8, 8)
    head.writeUInt32LE(0x5c210000, 10) // a fixed date keeps builds reproducible
    head.writeUInt32LE(crc, 14)
    head.writeUInt32LE(deflated.length, 18)
    head.writeUInt32LE(data.length, 22)
    head.writeUInt16LE(nameBuf.length, 26)
    local.push(head, nameBuf, deflated)
    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0x0800, 8)
    cd.writeUInt16LE(8, 10)
    cd.writeUInt32LE(0x5c210000, 12)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(deflated.length, 20)
    cd.writeUInt32LE(data.length, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt32LE(offset, 42)
    central.push(cd, nameBuf)
    offset += head.length + nameBuf.length + deflated.length
  }
  const cdBuf = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cdBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, cdBuf, end])
}

export function build() {
  const manifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'))
  fs.mkdirSync(out, { recursive: true })
  const written = []
  for (const browser of ['chrome', 'firefox']) {
    const entries = files(src)
      .filter((f) => f !== 'manifest.json')
      .sort()
      .map((name) => ({ name, data: fs.readFileSync(path.join(src, name)) }))
    entries.unshift({ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifestFor(manifest, browser), null, 2)) })
    const file = path.join(out, `opnduck-extension-${browser}-${manifest.version}.zip`)
    fs.writeFileSync(file, zip(entries))
    written.push(file)
  }
  return written
}

if (process.argv[1] === fileURLToPath(import.meta.url)) for (const f of build()) console.log(f)
