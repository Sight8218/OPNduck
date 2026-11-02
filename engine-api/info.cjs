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
 * What this machine can do, for GET /v1/info: GPU names, free disk space and whether FFmpeg and yt-dlp are installed.
 * Starts a few programs, so the answer is cached for a minute. No Electron.
 */
const fs = require('node:fs')
const os = require('node:os')
const { spawnSync } = require('node:child_process')

const works = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: 'ignore', timeout: 4000 })
  return !r.error && r.status === 0
}

/**
 * @param {object} deps
 * @param {() => string} deps.outputDir  where results are saved (its free space is reported)
 * @param {() => string} [deps.ytdlpCommand]
 */
function createInfo({ outputDir, ytdlpCommand = () => 'yt-dlp' }) {
  let cached = null
  let at = 0
  return () => {
    if (cached && Date.now() - at < 60000) return cached
    let gpus = []
    const smi = spawnSync('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], { encoding: 'utf8', timeout: 4000 })
    if (!smi.error && smi.status === 0) gpus = smi.stdout.split('\n').map((l) => l.trim()).filter(Boolean)
    let freeDiskBytes = null
    try {
      const dir = outputDir()
      fs.mkdirSync(dir, { recursive: true })
      const s = fs.statfsSync(dir)
      freeDiskBytes = s.bavail * s.bsize
    } catch {
      /* folder missing or unreadable */
    }
    cached = { gpus, freeDiskBytes, tools: { ffmpeg: works('ffmpeg', ['-version']), ytdlp: works(ytdlpCommand(), ['--version']) }, platform: process.platform, cpus: os.cpus().length }
    at = Date.now()
    return cached
  }
}

module.exports = { createInfo }
