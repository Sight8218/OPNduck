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
 * Tool detection and one-click installs: yt-dlp, ffmpeg, LibreOffice, the ncnn upscalers, and the
 * Python environment (faster-whisper, Demucs, the PyTorch engine). No Electron: folders come from
 * the platform object, so the desktop app and the terminal app share this.
 */
const { spawn } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

/** @param {object} platform see core/platform.cjs */
function createTools(platform) {
  /**
   * yt-dlp isn't bundled — it's expected on PATH. Instead of only surfacing
   * that as a cryptic per-download failure, the Downloader card checks this
   * up front and shows a plain install command for the user's OS.
   */
  function ytDlpInstallHint() {
    if (process.platform === 'win32') return 'winget install yt-dlp.yt-dlp'
    if (process.platform === 'darwin') return 'brew install yt-dlp'
    return 'sudo pacman -S yt-dlp   (or: pip install -U yt-dlp)'
  }

  /* --- yt-dlp: the system one, or a copy OPNduck downloads itself (and can update in place) ---
   * Sites change often and yt-dlp has to keep up, so the managed copy lives in userData where no root
   * is needed. It wins over PATH once it exists. */
  const YTDLP_ASSET = process.platform === 'win32' ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp_linux'
  const YTDLP_RELEASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/'
  function managedYtDlpPath() {
    return path.join(platform.paths.userData, 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')
  }
  function ytdlpCommand() {
    const managed = managedYtDlpPath()
    return fs.existsSync(managed) ? managed : 'yt-dlp'
  }


  let ytdlpInstalling = false
  /** Downloads the newest yt-dlp from its GitHub release, verifies the published SHA-256, and swaps it in. */

  /** LibreOffice (soffice) does the document conversions — same detect-and-guide idea. */
  function libreOfficeInstallHint() {
    if (process.platform === 'win32') return 'winget install TheDocumentFoundation.LibreOffice'
    if (process.platform === 'darwin') return 'brew install --cask libreoffice'
    return 'sudo pacman -S libreoffice-fresh   (or your distro\'s package manager)'
  }

  /** On Windows neither winget nor the LibreOffice installer adds it to PATH, so also look
   *  in the default install folders. soffice.com is the console launcher: soffice.exe is a
   *  GUI program that prints nothing to a pipe. */
  function sofficeCommand() {
    if (process.platform !== 'win32') return 'soffice'
    for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) {
      if (!base) continue
      const candidate = path.join(base, 'LibreOffice', 'program', 'soffice.com')
      if (fs.existsSync(candidate)) return candidate
    }
    return 'soffice'
  }


  /** Chromaprint's fpcalc (the music tagger's fingerprinting) isn't bundled either. */
  function fpcalcInstallHint() {
    if (process.platform === 'win32') return 'winget install AcoustID.Chromaprint'
    if (process.platform === 'darwin') return 'brew install chromaprint'
    return 'sudo pacman -S chromaprint   (or your distro\'s package manager)'
  }

  /** Same idea as yt-dlp: ffmpeg isn't bundled either. */
  function ffmpegInstallHint() {
    if (process.platform === 'win32') return 'winget install Gyan.FFmpeg'
    if (process.platform === 'darwin') return 'brew install ffmpeg'
    return 'sudo pacman -S ffmpeg   (or your distro\'s package manager)'
  }


  /**
   * realesrgan-ncnn-vulkan is essentially never pre-installed anywhere (no
   * winget/brew formula confirmed to exist for it) — Arch has an AUR package;
   * everyone else gets pointed at the upstream releases page rather than a
   * fabricated command.
   */
  function realesrganInstallHint() {
    if (process.platform === 'linux') return 'yay -S realesrgan-ncnn-vulkan-bin   (AUR; or see the link below on other distros)'
    return 'Download from https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan/releases'
  }


  /** Same situation as realesrgan-ncnn-vulkan — essentially never pre-installed. */
  function rifeInstallHint() {
    if (process.platform === 'linux') return 'yay -S rife-ncnn-vulkan-bin   (AUR; or see the link below on other distros)'
    return 'Download from https://github.com/nihui/rife-ncnn-vulkan/releases'
  }


  /**
   * faster-whisper is a Python library, not a binary — so the check is whether the
   * user's Python can import it. OPNDUCK_PYTHON points at a specific interpreter
   * (e.g. a venv's), for distros like Arch where a global pip install is refused.
   */
  function pythonCommand() {
    return process.env.OPNDUCK_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
  }

  /**
   * The Python that runs Demucs. OPNDUCK_PYTHON wins; otherwise the venv the install hint creates
   * (~/.opnduck-venv) is used automatically if it exists, so there's nothing to configure; otherwise
   * the system Python. Kept separate from pythonCommand() because the venv holds torch/demucs but
   * not necessarily faster-whisper, which the Subtitles card looks for in the regular Python.
   */
  const VENV_DIR = process.env.OPNDUCK_VENV || path.join(os.homedir(), process.platform === 'win32' ? 'opnduck-venv' : '.opnduck-venv')
  const VENV_PYTHON = path.join(VENV_DIR, ...(process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python']))

  function demucsPython() {
    if (process.env.OPNDUCK_PYTHON) return process.env.OPNDUCK_PYTHON
    return fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : pythonCommand()
  }

  /** True if the OPNduck venv has a package folder installed (a cheap file check, no Python spawn). */
  function venvHasPackage(name) {
    try {
      const libs = process.platform === 'win32' ? [path.join(VENV_DIR, 'Lib')] : fs.readdirSync(path.join(VENV_DIR, 'lib')).map((d) => path.join(VENV_DIR, 'lib', d))
      return libs.some((lib) => fs.existsSync(path.join(lib, 'site-packages', name)))
    } catch {
      return false
    }
  }

  /** True if an NVIDIA GPU driver is present (nvidia-smi exists), i.e. GPU Whisper is worth offering. */
  let nvidiaPresent = null // nvidia-smi blocks the main process while it runs, so ask once per session
  function hasNvidiaGpu() {
    nvidiaPresent ??= (() => {
      try {
        return require('node:child_process').spawnSync('nvidia-smi', ['-L'], { timeout: 4000 }).status === 0
      } catch {
        return false
      }
    })()
    return nvidiaPresent
  }

  /* --- Engine checks: "can Python import X?" spawns an interpreter (0.5 to 2.5 s), so the answer is
   *  remembered in memory and in userData/engine-cache.json. A cached answer is returned at once and
   *  re-checked in the background; it is dropped when the Python or the venv's packages change. --- */
  // @category: system/engine-cache
  let engineDisk = null
  const engineChecks = new Map() // key -> { fp, promise }
  const engineCacheFile = () => path.join(platform.paths.userData, 'engine-cache.json')

  function loadEngineDisk() {
    if (engineDisk) return engineDisk
    try {
      const parsed = JSON.parse(fs.readFileSync(engineCacheFile(), 'utf8'))
      engineDisk = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
      engineDisk = {}
    }
    return engineDisk
  }

  function saveEngineDisk() {
    try {
      const file = engineCacheFile()
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(engineDisk))
      fs.renameSync(`${file}.tmp`, file)
    } catch {
      /* a cache that can't be saved just means a slower next start */
    }
  }

  /** Changes whenever packages are installed into or removed from the OPNduck venv. */
  function venvFingerprint() {
    try {
      const lib = process.platform === 'win32' ? path.join(VENV_DIR, 'Lib') : path.join(VENV_DIR, 'lib', fs.readdirSync(path.join(VENV_DIR, 'lib')).find((d) => d.startsWith('python')) ?? '')
      return String(fs.statSync(path.join(lib, 'site-packages')).mtimeMs)
    } catch {
      return 'no-venv'
    }
  }

  /** Runs `python -c code` and resolves true when it exits 0. */
  function pythonCheck(python, code) {
    return new Promise((resolve) => {
      let child
      try {
        child = spawn(python, ['-c', code], { cwd: pythonCwd() })
      } catch {
        resolve(false)
        return
      }
      child.on('error', () => resolve(false))
      child.on('close', (exit) => resolve(exit === 0))
    })
  }

  function cachedEngineCheck(key, python, code) {
    const fp = `${python}|${venvFingerprint()}`
    const hit = engineChecks.get(key)
    if (hit && hit.fp === fp) return hit.promise
    const refresh = () =>
      pythonCheck(python, code).then((value) => {
        loadEngineDisk()[key] = { fp, value }
        saveEngineDisk()
        engineChecks.set(key, { fp, promise: Promise.resolve(value) })
        return value
      })
    const saved = loadEngineDisk()[key]
    let promise
    if (saved && saved.fp === fp && typeof saved.value === 'boolean') {
      promise = Promise.resolve(saved.value)
      void refresh()
    } else promise = refresh()
    engineChecks.set(key, { fp, promise })
    return promise
  }

  function clearEngineCache() {
    engineChecks.clear()
    engineDisk = {}
    try {
      fs.rmSync(engineCacheFile(), { force: true })
    } catch {
      /* nothing to remove */
    }
  }
  // --- end: system/engine-cache ---

  /** Library folders of the CUDA 12 runtime the whisper-gpu install puts in the OPNduck venv
   *  (site-packages/nvidia/<lib>/lib on Linux, .../bin on Windows). Empty when it isn't installed. */
  function venvNvidiaLibDirs() {
    try {
      const site = process.platform === 'win32'
        ? path.join(VENV_DIR, 'Lib', 'site-packages')
        : path.join(VENV_DIR, 'lib', fs.readdirSync(path.join(VENV_DIR, 'lib')).find((d) => d.startsWith('python')) ?? '', 'site-packages')
      const root = path.join(site, 'nvidia')
      const sub = process.platform === 'win32' ? 'bin' : 'lib'
      const dirs = fs.readdirSync(root).map((d) => path.join(root, d, sub)).filter((d) => fs.existsSync(d))
      // Only count it as installed when the CUDA 12 cuBLAS is really there.
      const hasCublas12 = dirs.some((d) => fs.readdirSync(d).some((f) => /^(lib)?cublas(64_12\.dll|\.so\.12)/.test(f)))
      return hasCublas12 ? dirs : []
    } catch {
      return []
    }
  }

  /** The Python that runs faster-whisper: OPNDUCK_PYTHON, else the OPNduck venv once it has the package
   *  (the one-click install puts it there), else the system Python (e.g. a distro python-faster-whisper). */
  function whisperPython() {
    if (process.env.OPNDUCK_PYTHON) return process.env.OPNDUCK_PYTHON
    return venvHasPackage('faster_whisper') ? VENV_PYTHON : pythonCommand()
  }

  function fasterWhisperInstallHint() {
    if (process.platform === 'win32') return 'python -m pip install faster-whisper'
    if (process.platform === 'darwin') return 'python3 -m pip install faster-whisper'
    return 'yay -S python-faster-whisper   (AUR; or pip install faster-whisper in a venv and set OPNDUCK_PYTHON to its python)'
  }

  /** Where Python runs from: `python -c` puts the cwd on sys.path, so never a shared/user folder. */
  function pythonCwd() {
    const dir = platform.paths.userData
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  function demucsInstallHint() {
    if (process.platform === 'win32') return 'python -m venv %USERPROFILE%\\opnduck-venv  &&  %USERPROFILE%\\opnduck-venv\\Scripts\\pip install torch demucs soundfile   (OPNduck finds that venv by itself — just restart it)'
    return 'python -m venv ~/.opnduck-venv && ~/.opnduck-venv/bin/pip install torch demucs soundfile   (OPNduck finds that venv by itself — just restart it)'
  }

  /** Can the fast (PyTorch) video upscaling engine run here, and would an NVIDIA GPU make it worthwhile? */



  /* --- One-click Python tool install (AI Audio / Subtitles) ---
   * Creates the OPNduck venv (~/.opnduck-venv) if needed and pip-installs the packages into it,
   * streaming pip's output lines to the window that asked. One install at a time; cancelable. */
  // whisper-gpu adds the CUDA 12 runtime libraries the prebuilt GPU Whisper engine (ctranslate2) needs.
  const INSTALL_PACKAGES = {
    demucs: ['torch', 'demucs', 'soundfile'],
    whisper: ['faster-whisper'],
    torch: ['torch', 'numpy'], // the fast video upscaling engine (CUDA PyTorch)
    beats: ['librosa', 'soundfile'], // Beat Finder: tempo, beats and key (small, no PyTorch)
    'whisper-gpu': ['faster-whisper', 'nvidia-cublas-cu12', 'nvidia-cudnn-cu12'],
  }
  let installChild = null

  function checkYtDlp() {
    return new Promise((resolve) => {
      const managed = ytdlpCommand() !== 'yt-dlp'
      const done = (available, version) => resolve({ available, installHint: ytDlpInstallHint(), version, managed })
      let child
      try {
        child = spawn(ytdlpCommand(), ['--version'])
      } catch {
        done(false)
        return
      }
      let out = ''
      child.stdout.on('data', (c) => (out += c))
      child.on('error', () => done(false))
      child.on('close', (code) => done(code === 0, code === 0 ? out.trim() : undefined))
    })
  }


  async function installYtDlp() {
    if (ytdlpInstalling) return { ok: false, error: 'An update is already running.' }
    ytdlpInstalling = true
    const dest = managedYtDlpPath()
    const tmp = `${dest}.download`
    try {
      const get = async (url) => {
        const res = await fetch(url, { signal: AbortSignal.timeout(120_000) })
        if (!res.ok) throw new Error(`Download failed (${res.status}).`)
        // Redirects land on GitHub's own release CDN; refuse anything that isn't https.
        if (new URL(res.url).protocol !== 'https:') throw new Error('Unexpected download location.')
        return Buffer.from(await res.arrayBuffer())
      }
      const sums = (await get(YTDLP_RELEASE + 'SHA2-256SUMS')).toString('utf8')
      const want = sums.split('\n').map((l) => l.trim().split(/\s+/)).find((p) => p[1] === YTDLP_ASSET)?.[0]
      if (!want) throw new Error("Couldn't find the checksum for this platform.")
      const bin = await get(YTDLP_RELEASE + YTDLP_ASSET)
      if (crypto.createHash('sha256').update(bin).digest('hex') !== want) throw new Error('The download failed its checksum, so it was discarded.')
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(tmp, bin, { mode: 0o755 })
      fs.renameSync(tmp, dest)
      return { ok: true }
    } catch (err) {
      fs.rmSync(tmp, { force: true })
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      ytdlpInstalling = false
    }
  }


  function checkLibreOffice() {
    return new Promise((resolve) => {
      let child
      try {
        child = spawn(sofficeCommand(), ['--version'])
      } catch {
        resolve({ available: false, installHint: libreOfficeInstallHint() })
        return
      }
      child.on('error', () => resolve({ available: false, installHint: libreOfficeInstallHint() }))
      child.on('close', (code) => resolve({ available: code === 0, installHint: libreOfficeInstallHint() }))
    })
  }


  function checkFfmpeg() {
    return new Promise((resolve) => {
      let child
      try {
        child = spawn('ffmpeg', ['-version'])
      } catch {
        resolve({ available: false, installHint: ffmpegInstallHint() })
        return
      }
      child.on('error', () => resolve({ available: false, installHint: ffmpegInstallHint() }))
      child.on('close', (code) => resolve({ available: code === 0, installHint: ffmpegInstallHint() }))
    })
  }


  function checkFpcalc() {
    return new Promise((resolve) => {
      let child
      try {
        child = spawn('fpcalc', ['-version'])
      } catch {
        resolve({ available: false, installHint: fpcalcInstallHint() })
        return
      }
      child.on('error', () => resolve({ available: false, installHint: fpcalcInstallHint() }))
      child.on('close', (code) => resolve({ available: code === 0, installHint: fpcalcInstallHint() }))
    })
  }


  function checkRealesrgan() {
    return new Promise((resolve) => {
      let child
      try {
        child = spawn('realesrgan-ncnn-vulkan', ['-h'])
      } catch {
        resolve({ available: false, installHint: realesrganInstallHint() })
        return
      }
      // Unlike yt-dlp/ffmpeg, this binary exits non-zero even for -h — any exit
      // at all (vs. an 'error' event, which only fires when the binary is
      // genuinely missing) means it was found and ran.
      child.on('error', () => resolve({ available: false, installHint: realesrganInstallHint() }))
      child.on('close', () => resolve({ available: true, installHint: realesrganInstallHint() }))
    })
  }


  function checkRife() {
    return new Promise((resolve) => {
      let child
      try {
        child = spawn('rife-ncnn-vulkan', ['-h'])
      } catch {
        resolve({ available: false, installHint: rifeInstallHint() })
        return
      }
      child.on('error', () => resolve({ available: false, installHint: rifeInstallHint() }))
      child.on('close', () => resolve({ available: true, installHint: rifeInstallHint() }))
    })
  }


  /** Can the fast (PyTorch) video upscaling engine run here, and would an NVIDIA GPU make it worthwhile? `ready` is supplied by the caller, which knows the user's engine setting. */
  async function checkTorchEngine(ready) {
    return { available: await ready(), nvidia: hasNvidiaGpu() }
  }

  async function checkDemucs() {
    return {
      available: await cachedEngineCheck('demucs', demucsPython(), 'import torch, demucs, soundfile'),
      installHint: demucsInstallHint(),
    }
  }

  async function checkBeats() {
    return { available: await cachedEngineCheck('beats', demucsPython(), 'import librosa, soundfile'), installHint: 'pip install librosa soundfile' }
  }

  async function checkFasterWhisper() {
    // cwd = userData (see pythonCwd): `python -c` puts the cwd on sys.path, so never a folder that could hold a planted faster_whisper.py.
    const available = await cachedEngineCheck('whisper', whisperPython(), 'import faster_whisper')
    return { available, installHint: fasterWhisperInstallHint(), nvidia: hasNvidiaGpu(), gpu: venvNvidiaLibDirs().length > 0 }
  }

  /** Installs a Python tool; `send(line)` receives pip's output lines. */
  function installTool(tool, send) {
    if (!Object.hasOwn(INSTALL_PACKAGES, tool)) return { ok: false, error: 'Unknown tool.' }
    if (process.env.OPNDUCK_PYTHON) return { ok: false, error: 'OPNDUCK_PYTHON is set, so OPNduck is not managing Python packages. Install them in that Python yourself.' }
    if (installChild) return { ok: false, error: 'An install is already running.' }
    const run = (cmd, args) =>
      new Promise((resolve) => {
        let child
        try {
          child = spawn(cmd, args, { cwd: pythonCwd(), env: { ...process.env, PIP_DISABLE_PIP_VERSION_CHECK: '1', PYTHONUNBUFFERED: '1' } })
        } catch (err) {
          resolve({ code: -1, tail: String(err.message ?? err) })
          return
        }
        installChild = child
        let tail = ''
        const onData = (chunk) => {
          for (const raw of String(chunk).split(/\r?\n|\r/)) {
            const line = raw.trim()
            if (!line) continue
            tail = (tail + '\n' + line).slice(-600)
            send(line.slice(0, 200))
          }
        }
        child.stdout.on('data', onData)
        child.stderr.on('data', onData)
        child.on('error', (err) => resolve({ code: -1, tail: String(err.message ?? err) }))
        child.on('close', (code, signal) => resolve({ code: signal ? -2 : code, tail }))
      })
    return (async () => {
      try {
        if (!fs.existsSync(VENV_PYTHON)) {
          send('Creating the OPNduck Python environment…')
          const made = await run(pythonCommand(), ['-m', 'venv', VENV_DIR])
          if (made.code === -2) return { ok: false, error: 'Canceled.' }
          if (made.code !== 0) return { ok: false, error: `Couldn't create a Python environment (is Python 3 installed?)\n${made.tail}` }
        }
        send('Installing packages…')
        const res = await run(VENV_PYTHON, ['-m', 'pip', 'install', '--progress-bar', 'off', ...INSTALL_PACKAGES[tool]])
        if (res.code === -2) return { ok: false, error: 'Canceled.' }
        if (res.code !== 0) return { ok: false, error: `pip failed:\n${res.tail}` }
        clearEngineCache() // what Python can import has changed
        return { ok: true }
      } finally {
        installChild = null
      }
    })()
  }

  function cancelInstall() {
    installChild?.kill()
  }

  return {
    ytDlpInstallHint, ffmpegInstallHint, libreOfficeInstallHint, realesrganInstallHint, rifeInstallHint,
    fasterWhisperInstallHint, demucsInstallHint,
    managedYtDlpPath, ytdlpCommand, sofficeCommand, pythonCommand, demucsPython, whisperPython, pythonCwd,
    venvHasPackage, hasNvidiaGpu, venvNvidiaLibDirs, cachedEngineCheck, clearEngineCache,
    VENV_DIR, VENV_PYTHON,
    checkYtDlp, installYtDlp, checkLibreOffice, checkFfmpeg, checkFpcalc, fpcalcInstallHint, checkRealesrgan, checkRife,
    checkBeats, checkTorchEngine, checkDemucs, checkFasterWhisper, installTool, cancelInstall,
  }
}

module.exports = { createTools }
