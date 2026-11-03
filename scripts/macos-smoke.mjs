// OPNduck — local-first media processing suite. Copyright (C) 2026 Aaron Jonsson. GPL-3.0-or-later (see LICENSE).
// Smoke test for the built macOS app (also usable against any build of OPNduck): starts it with Playwright, checks that
// the window opens, Settings opens, the tool checks find yt-dlp and FFmpeg, and that a real FFmpeg conversion of a
// generated test clip finishes. YouTube is not touched: CI runners get bot-blocked.
//
//   node scripts/macos-smoke.mjs <path to the app's executable> [extra args, such as . for an unpackaged run]
//
// Needs `playwright-core` (CI installs it with `npm i --no-save playwright-core`) and ffmpeg on the PATH.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [executablePath, ...args] = process.argv.slice(2)
if (!executablePath) {
  console.error('Usage: node scripts/macos-smoke.mjs <executable> [args…]')
  process.exit(2)
}
const { _electron } = await import('playwright-core')

const ok = (what) => console.log(`ok: ${what}`)
const fail = (what) => {
  console.error(`FAILED: ${what}`)
  process.exitCode = 1
  throw new Error(what)
}
const dir = mkdtempSync(join(tmpdir(), 'opnduck-smoke-'))
const clip = join(dir, 'clip.mp4')
const made = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=15', '-f', 'lavfi', '-i', 'sine=duration=2', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', clip])
if (made.status !== 0) fail('ffmpeg could not make the test clip (is it on the PATH?)')

const app = await _electron.launch({ executablePath, args: [...args, `--user-data-dir=${join(dir, 'data')}`], env: { ...process.env, OPNDUCK_PROD: '1' }, timeout: 60000 })
try {
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  ok(`the window opened (${await win.title()})`)
  await win.getByRole('button', { name: 'Skip' }).click({ timeout: 8000 }).catch(() => {}) // the first-run setup wizard, when it shows

  await win.evaluate(() => (location.hash = '#/settings'))
  await win.getByText('Smart scheduling').first().waitFor({ timeout: 15000 })
  ok('Settings opens')

  const tools = await win.evaluate(async () => ({ ffmpeg: await window.opnduckHost.checkFfmpeg(), ytdlp: await window.opnduckHost.checkYtDlp() }))
  if (!tools.ffmpeg.available) fail(`the app does not find FFmpeg (${tools.ffmpeg.installHint})`)
  ok('the app finds FFmpeg')
  if (!tools.ytdlp.available) fail(`the app does not find yt-dlp (${tools.ytdlp.installHint})`)
  ok('the app finds yt-dlp')

  const finished = await win.evaluate(
    async ({ input, out }) => {
      const id = await window.opnduckHost.tasks.startConvert({ inputPath: input, container: 'MKV', mode: 'transcode', destination: out })
      for (let i = 0; i < 120; i++) {
        const t = (await window.opnduckHost.tasks.list()).find((x) => x.id === id)
        if (t && ['done', 'error', 'canceled'].includes(t.status)) return { status: t.status, error: t.error ?? '', file: await window.opnduckHost.tasks.fileOf(id) }
        await new Promise((r) => setTimeout(r, 500))
      }
      return { status: 'timeout', error: '', file: null }
    },
    { input: clip, out: dir },
  )
  if (finished.status !== 'done') fail(`the conversion ended as ${finished.status}: ${finished.error}`)
  if (!finished.file || !existsSync(finished.file)) fail('the converted file is missing')
  ok(`a real conversion finished (${finished.file})`)
  console.log('All checks passed.')
} finally {
  await app.close()
}
