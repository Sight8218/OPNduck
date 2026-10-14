/*
 * Windows smoke test for the installed app (run by .github/workflows/windows-smoke.yml).
 * Launches the installed OPNduck.exe through Playwright, then drives real jobs through the
 * same window.opnduckHost bridge the UI uses: tool detection, ffmpeg and LibreOffice
 * conversions, and a yt-dlp download of a file with a non-ASCII name. Writes a Markdown
 * report and exits non-zero if a required check fails.
 *
 * Usage: node scripts/windows-smoke.mjs <path to OPNduck.exe> <output dir>
 */
import { _electron as electron } from 'playwright-core'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const [exe, outArg] = process.argv.slice(2)
const outDir = outArg && path.resolve(outArg) // the app only accepts absolute paths
if (!exe || !outArg) {
  console.error('usage: node scripts/windows-smoke.mjs <OPNduck.exe> <output dir>')
  process.exit(2)
}
const fixtures = path.join(outDir, 'fixtures')
const converted = path.join(outDir, 'converted')
const downloads = path.join(outDir, 'downloads')
for (const d of [fixtures, converted, downloads]) fs.mkdirSync(d, { recursive: true })

const results = [] // { name, ok, required, detail }
function record(name, ok, detail = '', required = true) {
  results.push({ name, ok, required, detail })
  console.log(`${ok ? 'PASS' : required ? 'FAIL' : 'WARN'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

// Fixtures: a 2s test video whose name needs UTF-8 to survive, and a small text document.
const videoName = 'Café ünïcode 日本.mp4'
const video = path.join(fixtures, videoName)
const ff = spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=15',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-c:v', 'libx264', '-c:a', 'aac', video])
if (ff.status !== 0) throw new Error(`fixture ffmpeg failed: ${ff.stderr}`)
const doc = path.join(fixtures, 'notes.txt')
fs.writeFileSync(doc, 'OPNduck Windows smoke test\nSecond line.\n')

// Serves the fixture video so yt-dlp's generic extractor can "download" it offline.
const server = http.createServer((req, res) => {
  const file = path.join(fixtures, decodeURIComponent(new URL(req.url, 'http://x').pathname.slice(1)))
  if (!file.startsWith(fixtures) || !fs.existsSync(file)) {
    res.writeHead(404).end()
    return
  }
  res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': fs.statSync(file).size })
  fs.createReadStream(file).pipe(res)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port

const app = await electron.launch({ executablePath: exe, args: [], timeout: 60_000 })
const consoleErrors = []
const page = await app.firstWindow()
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
page.on('pageerror', (e) => consoleErrors.push(String(e)))

try {
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => window.opnduckHost?.isDesktop === true, null, { timeout: 30_000 })
  const title = await page.title()
  record('App launches and the UI loads', true, `title "${title}", url ${page.url().split('/').slice(-2).join('/')}`)
  await page.waitForTimeout(2000)
  await page.screenshot({ path: path.join(outDir, 'home.png') })

  const tools = await page.evaluate(async () => ({
    ytDlp: await window.opnduckHost.checkYtDlp(),
    ffmpeg: await window.opnduckHost.checkFfmpeg(),
    libreOffice: await window.opnduckHost.checkLibreOffice(),
  }))
  record('yt-dlp detected', tools.ytDlp.available)
  record('ffmpeg detected', tools.ffmpeg.available)
  record('LibreOffice detected (installed to Program Files, not on PATH)', tools.libreOffice.available)

  /** Starts a job through the bridge and waits for it to finish. */
  async function runJob(kind, req, timeoutMs = 180_000) {
    const id = await page.evaluate(([k, r]) => window.opnduckHost.tasks[k](r), [kind, req])
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const t = await page.evaluate((i) => window.opnduckHost.tasks.list().then((l) => l.find((x) => x.id === i)), id)
      if (t && ['done', 'error', 'canceled'].includes(t.status)) return t
      if (Date.now() > deadline) return { ...t, status: 'timeout' }
      await page.waitForTimeout(500)
    }
  }
  const existing = (name) => fs.existsSync(path.join(converted, name))

  for (const [container, out] of [['MP3', 'mp3'], ['GIF', 'gif'], ['MKV', 'mkv']]) {
    const t = await runJob('startConvert', { inputPath: video, container, mode: 'transcode', destination: converted })
    const want = videoName.replace(/\.mp4$/, `.${out}`)
    record(`Convert MP4 → ${container} (ffmpeg)`, t.status === 'done' && existing(want), t.error ?? t.label)
  }
  const pdf = await runJob('startConvert', { inputPath: doc, container: 'PDF', mode: 'transcode', destination: converted })
  record('Convert TXT → PDF (LibreOffice)', pdf.status === 'done' && existing('notes.pdf'), pdf.error ?? pdf.label)

  const url = `http://127.0.0.1:${port}/${encodeURIComponent(videoName)}`
  const dl = await runJob('startDownload', { url, format: 'MP4', destination: downloads })
  record('Download via yt-dlp', dl.status === 'done', dl.error ?? dl.label)
  record('Downloaded file name keeps non-ASCII characters', dl.label === videoName, `label "${dl.label}"`)
  record('Downloaded file size read from disk', dl.sizeIsEstimate === false, `sizeBytes ${dl.sizeBytes}`)

  // Real-site download: YouTube often blocks CI runners, so this one only warns.
  const yt = await runJob('startDownload', { url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', format: 'MP3', destination: downloads }, 240_000)
  record('YouTube download (best effort, CI IPs are often blocked)', yt.status === 'done', yt.error ?? yt.label, false)

  // Frameless + transparent windows have a history of misbehaving on Windows.
  // CI screens are small (1024x720), so the window starts filling the work area and already
  // counts as maximized. Shrink it first so the button has something to do.
  const before = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    if (w.isMaximized()) w.unmaximize()
    w.setBounds({ x: 20, y: 20, width: 960, height: 620 })
    return w.getBounds()
  })
  await page.evaluate(() => window.opnduckHost.window.maximize())
  await page.waitForTimeout(1500)
  const max = await app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows()[0]
    return { isMaximized: w.isMaximized(), bounds: w.getBounds(), workArea: screen.getPrimaryDisplay().workArea }
  })
  await page.screenshot({ path: path.join(outDir, 'maximized.png') })
  record('Maximize button maximizes the window', max.isMaximized, JSON.stringify(max), false)
  await page.evaluate(() => window.opnduckHost.window.maximize())
  await page.waitForTimeout(1500)
  const restored = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds())
  record('Maximize button toggles back to the original size', restored.width === before.width && restored.height === before.height,
    `before ${JSON.stringify(before)}, after ${JSON.stringify(restored)}`, false)
  const resized = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.setSize(1100, 700)
    return { resizable: w.isResizable(), size: w.getSize() }
  })
  record('Window is resizable', resized.resizable && resized.size[0] === 1100, JSON.stringify(resized), false)

  record('No renderer errors in the console', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '), false)
} catch (err) {
  record('Smoke test ran to completion', false, err.stack ?? String(err))
  await page.screenshot({ path: path.join(outDir, 'failure.png') }).catch(() => {})
} finally {
  await app.close().catch(() => {})
  server.close()
}

const lines = ['## OPNduck Windows smoke test', '', '| Check | Result | Detail |', '|---|---|---|']
for (const r of results) {
  const mark = r.ok ? '✅ pass' : r.required ? '❌ fail' : '⚠️ warn'
  lines.push(`| ${r.name} | ${mark} | ${String(r.detail).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 400)} |`)
}
lines.push('', 'Drag and drop needs a real mouse drag from Explorer and is not covered here.')
fs.writeFileSync(path.join(outDir, 'report.md'), lines.join('\n') + '\n')
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n')
process.exit(results.some((r) => r.required && !r.ok) ? 1 : 0)
