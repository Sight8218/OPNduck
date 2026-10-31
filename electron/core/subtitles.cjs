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
 * Subtitles: offline speech-to-subtitles with faster-whisper (CPU or NVIDIA GPU), SRT or VTT.
 * No Electron: everything it needs comes in through `ctx` (see core/*.cjs).
 */
const path = require('node:path')
const fs = require('node:fs')

function createSubtitles(ctx) {
  const {
    venvNvidiaLibDirs, createModelWorker, whisperPython, handleStart, assertAbsolutePath, assertOneOf, defaultDownloadDir, uniqueOutputPath, addTask, broadcastTasks, runInPool, whisperPool, tasks, updateTask, isCanceled, pythonCommand, platform,
  } = ctx

  /**
   * Subtitle generation — faster-whisper transcribes the source's speech into an
   * .srt/.vtt written beside the other outputs, named after the source so video
   * players pick it up automatically. faster-whisper decodes audio itself (PyAV),
   * so ffmpeg isn't needed. The first run of each model downloads it from
   * Hugging Face into the user's cache; after that everything is offline.
   */
  // @category: subtitles/whisper-transcription
  const WHISPER_MODELS = ['tiny', 'base', 'small', 'medium']

  const SUBTITLE_FORMATS = ['srt', 'vtt']

  const WHISPER_SCRIPT = platform.scriptPath('whisper_subtitles.py')

  // GPU Whisper finds its CUDA 12 libraries through the dynamic-linker path (PATH on Windows).
  function whisperEnv() {
    const dirs = venvNvidiaLibDirs()
    if (!dirs.length) return {}
    const key = process.platform === 'win32' ? 'PATH' : 'LD_LIBRARY_PATH'
    return { [key]: [...dirs, process.env[key]].filter(Boolean).join(path.delimiter) }
  }

  const whisperWorker = createModelWorker({ python: () => whisperPython(), scriptPath: WHISPER_SCRIPT, env: whisperEnv })

  handleStart('tasks:startSubtitles', (_e, req) => {
    assertAbsolutePath(req.inputPath, 'inputPath')
    if (req.destination != null) assertAbsolutePath(req.destination, 'destination')
    assertOneOf(req.model, WHISPER_MODELS, 'model')
    assertOneOf(req.format, SUBTITLE_FORMATS, 'format')
    if (req.language !== 'auto' && !/^[a-z]{2,3}$/.test(req.language)) throw new Error(`Invalid language: ${req.language}`)
    if (req.translate != null && typeof req.translate !== 'boolean') throw new Error('Invalid translate option')
    const id = crypto.randomUUID()
    const destDir = req.destination || defaultDownloadDir()
    fs.mkdirSync(destDir, { recursive: true })

    const inputBase = path.basename(req.inputPath, path.extname(req.inputPath))
    // Translated subtitles get the usual language tag (movie.en.srt) so players pick them up as English.
    const outputPath = uniqueOutputPath(destDir, req.translate ? `${inputBase}.en` : inputBase, req.format)

    addTask(id, {
      state: {
        id,
        kind: 'subtitles',
        status: 'queued',
        progress: 0,
        label: path.basename(req.inputPath),
        format: req.format.toUpperCase(),
        quality: req.translate ? `Whisper ${req.model} → English` : `Whisper ${req.model}`,
        sizeBytes: null,
        sizeIsEstimate: false,
        thumbnailUrl: null,
        experimentalMatch: null,
      },
      child: null,
      finalPath: outputPath,
    })
    broadcastTasks()

    runInPool(whisperPool, id, () => {
      // Read here rather than passed as a path: inside a packaged app.asar, Node can
      // read the script but an external Python can't open it.
      const entry = tasks.get(id)
      updateTask(id, { status: 'running' })
      let lineBuf = ''
      // The worker keeps the loaded Whisper model between files (see createModelWorker).
      whisperWorker.run(
        { input: req.inputPath, output: outputPath, model: req.model, language: req.language, format: req.format, translate: !!req.translate },
        entry,
        {
          onStdout: (text) => {
            lineBuf += text
            const lines = lineBuf.split(/\r?\n/)
            lineBuf = lines.pop()
            for (const line of lines) {
              const progress = line.match(/^PROGRESS ([\d.]+)/)
              if (progress) updateTask(id, { progress: Math.min(1, Number(progress[1])) })
              const lang = line.match(/^LANG (\S+)/)
              if (lang) updateTask(id, { quality: `Whisper ${req.model} · ${lang[1]}${req.translate ? ' → English' : ''}` })
            }
          },
        },
      )
        .then(() => {
          let realSize = null
          try {
            realSize = fs.statSync(outputPath).size
          } catch {
            /* keep null if the output can't be read */
          }
          updateTask(id, {
            status: 'done',
            progress: 1,
            label: path.basename(outputPath),
            ...(realSize != null ? { sizeBytes: realSize } : {}),
          })
        })
        .catch((err) => {
          if (isCanceled(id)) return
          const missing = err.code === 'ENOENT'
          updateTask(id, {
            status: 'error',
            error: missing ? `${pythonCommand()} not found on PATH — faster-whisper needs Python 3` : err.message,
          })
        })

    })
    return id
  })

  return { WHISPER_MODELS, SUBTITLE_FORMATS, WHISPER_SCRIPT, whisperEnv, whisperWorker }
}

module.exports = { createSubtitles }
