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
 * Local dubbing (Beta): makes a video speak another language, all on this computer. Demucs splits the voice from the music
 * and effects, Whisper writes down what is said, Argos Translate translates each line, Piper speaks it, and each spoken
 * line is fitted into the time of the original. The new voice is mixed over the music (which dips while it speaks) and
 * muxed back into the video, which is not re-encoded. Voice cloning is out of scope on purpose. No Electron.
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')

/** Target languages with a free offline voice. */
const LANGUAGES = { en: 'English', sv: 'Swedish', de: 'German', fr: 'French', es: 'Spanish', it: 'Italian' }

/** MP4 only keeps three-letter language tags. */
const ISO3 = { en: 'eng', sv: 'swe', de: 'deu', fr: 'fra', es: 'spa', it: 'ita' }

function validate(req, { assertAbsolutePath, assertOneOf }) {
  assertAbsolutePath(req.inputPath, 'inputPath')
  if (req.destination != null) assertAbsolutePath(req.destination, 'destination')
  const o = { source: 'auto', whisperModel: 'base', keepOriginal: false, placement: 'track', ...req }
  assertOneOf(o.target, Object.keys(LANGUAGES), 'target')
  assertOneOf(o.placement, ['track', 'replace'], 'placement')
  assertOneOf(o.whisperModel, ['tiny', 'base', 'small', 'medium'], 'whisperModel')
  if (o.source !== 'auto' && !/^[a-z]{2,3}$/.test(o.source)) throw new Error("source is 'auto' or a language code like 'en'")
  if (typeof o.keepOriginal !== 'boolean') throw new Error('keepOriginal must be true or false')
  return o
}

/** The FFmpeg arguments that put the new audio into the video without touching the picture. */
function muxArgs({ input, audio, output, placement, language }) {
  // Subtitles are copied only into Matroska; MP4 and MOV take only their own text format, so they are left out there.
  const subs = /\.mkv$/i.test(output) ? ['-map', '0:s?', '-c:s', 'copy'] : []
  const lang = ['-metadata:s:a:0', `language=${ISO3[language] ?? language}`, '-metadata:s:a:0', 'title=Dubbed']
  if (placement === 'replace') return ['-y', '-i', input, '-i', audio, '-map', '0:v', '-map', '1:a', ...subs, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', ...lang, output]
  // The dub first (so players pick it), the original after it as a second track.
  return ['-y', '-i', input, '-i', audio, '-map', '0:v', '-map', '1:a', '-map', '0:a', ...subs, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', ...lang, '-disposition:a:0', 'default', '-disposition:a:1', '0', output]
}

function createDub(ctx) {
  const {
    handleStart, assertAbsolutePath, assertOneOf, defaultDownloadDir, uniqueOutputPath, addTask, broadcastTasks, runInPool, gpuPool, updateTask, tasks, probeMedia, isCanceled, spawnTracked, demucsPython, pythonCwd, demucsWorker, platform,
  } = ctx
  const SCRIPT = platform.scriptPath('dub.py')

  handleStart('tasks:startDub', async (_e, req) => {
    const o = validate(req, { assertAbsolutePath, assertOneOf })
    const id = crypto.randomUUID()
    const destDir = o.destination || defaultDownloadDir()
    fs.mkdirSync(destDir, { recursive: true })
    const ext = ['mp4', 'mkv', 'mov', 'm4v'].includes(path.extname(o.inputPath).slice(1).toLowerCase()) ? path.extname(o.inputPath).slice(1).toLowerCase() : 'mkv'
    const outputPath = uniqueOutputPath(destDir, `${path.basename(o.inputPath, path.extname(o.inputPath))}-${o.target}`, ext)
    addTask(id, {
      state: { id, kind: 'dub', status: 'queued', progress: 0, label: path.basename(o.inputPath), format: `Dub (Beta)`, quality: LANGUAGES[o.target], sizeBytes: null, sizeIsEstimate: false, thumbnailUrl: null, experimentalMatch: null },
      child: null,
      finalPath: outputPath,
    })
    broadcastTasks()
    runInPool(gpuPool, id, () => dubJob(id, o, outputPath)).catch((err) => updateTask(id, { status: 'error', error: `Dubbing failed to start: ${err.message}` }))
    return id
  })

  async function dubJob(id, o, outputPath) {
    const entry = tasks.get(id)
    updateTask(id, { status: 'running', stage: 'Reading the audio' })
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opnduck-dub-'))
    try {
      const info = await probeMedia(o.inputPath)
      if (!info?.hasAudio) return updateTask(id, { status: 'error', error: 'This video has no sound to dub.' })
      const inWav = path.join(tmp, 'in.wav')
      const stems = path.join(tmp, 'stems')
      fs.mkdirSync(stems)
      await spawnTracked('ffmpeg', ['-y', '-i', o.inputPath, '-map', '0:a:0', '-vn', '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', inWav], entry)
      if (isCanceled(id)) return
      updateTask(id, { progress: 0.05, stage: 'Separating the voice from the music' })
      await demucsWorker.run({ src: inWav, out: stems }, entry, {
        onStderr: (text) => {
          const m = [...text.matchAll(/(\d{1,3})%\|/g)].pop()
          if (m) updateTask(id, { progress: Math.min(0.4, 0.05 + 0.35 * (Number(m[1]) / 100)) })
        },
      })
      if (isCanceled(id)) return
      const dubWav = path.join(tmp, 'dub.wav')
      const job = { vocals: path.join(stems, 'vocals.wav'), music: path.join(stems, 'no_vocals.wav'), output: dubWav, workDir: tmp, voiceDir: path.join(platform.paths.userData, 'voices'), target: o.target, source: o.source, whisperModel: o.whisperModel, duration: info.duration, keepOriginalDb: o.keepOriginal ? -18 : 0 }
      fs.writeFileSync(path.join(tmp, 'job.json'), JSON.stringify(job))
      let text = ''
      try {
        await spawnTracked(demucsPython(), [SCRIPT, path.join(tmp, 'job.json')], entry, {
          cwd: pythonCwd(),
          onStdout: (chunk) => {
            text += chunk
            for (const line of chunk.split('\n')) {
              if (line.startsWith('@@PROGRESS ')) updateTask(id, { progress: 0.4 + 0.55 * Number(line.slice(11)) })
              else if (line.startsWith('@@STAGE ')) updateTask(id, { stage: line.slice(8) })
            }
          },
        })
      } catch (err) {
        if (/No module named/.test(`${err.message} ${text}`)) throw new Error('Dubbing needs its add-ons (translation and voices). Install them from the Dubbing card.')
        throw new Error(/@@FAIL (.*)/.exec(text)?.[1] ?? err.message)
      }
      if (isCanceled(id)) return
      updateTask(id, { progress: 0.96, stage: 'Putting the new voice in the video' })
      await spawnTracked('ffmpeg', muxArgs({ input: o.inputPath, audio: dubWav, output: outputPath, placement: o.placement, language: o.target }), entry)
      const lines = Number(/"lines": ?(\d+)/.exec(text)?.[1] ?? 0)
      updateTask(id, { status: 'done', progress: 1, stage: null, label: path.basename(outputPath), quality: `${LANGUAGES[o.target]}, ${lines} lines`, sizeBytes: fs.statSync(outputPath).size })
    } catch (err) {
      fs.rmSync(outputPath, { force: true })
      if (!isCanceled(id)) updateTask(id, { status: 'error', error: err.message, stage: null })
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  }

  return { dubJob }
}

module.exports = { createDub, validate, muxArgs, LANGUAGES }
