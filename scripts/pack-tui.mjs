// Builds the terminal app and packs it into release-build/opnduck-tui-<version>.tar.gz:
//   opnduck-tui/opnduck-tui.mjs   the app (needs Node 20+), executable
//   opnduck-tui/*.py              Python helpers the AI jobs use
//   opnduck-tui/README.md, LICENSE
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

const version = JSON.parse(readFileSync('package.json', 'utf8')).version
execFileSync('node', ['scripts/build-tui.mjs'], { stdio: 'inherit' })

const stage = 'release-build/opnduck-tui'
rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
for (const f of ['opnduck-tui.mjs', 'torch_upscale.py', 'demucs_separate.py', 'whisper_subtitles.py', 'beat_finder.py', 'bg_remove.py', 'dub.py', 'plugin_worker.cjs']) copyFileSync(`dist-tui/${f}`, `${stage}/${f}`)
chmodSync(`${stage}/opnduck-tui.mjs`, 0o755)
copyFileSync('LICENSE', `${stage}/LICENSE`)
writeFileSync(`${stage}/README.md`, `# OPNduck TUI ${version}

The OPNduck tools in a terminal: download, convert, trim, upscale, interpolate, subtitles and AI audio.
Needs Node.js 20 or newer. The AI tools also need the tools described in the main README (ffmpeg, yt-dlp, Python engines);
open the Setup screen (key 5) to see what is missing.

    ./opnduck-tui.mjs            # or: node opnduck-tui.mjs
    ./opnduck-tui.mjs --help

Settings and history are shared with the desktop app.
`)
const out = `release-build/opnduck-tui-${version}.tar.gz`
execFileSync('tar', ['-czf', out, '-C', 'release-build', 'opnduck-tui'], { stdio: 'inherit' })
console.log('packed', out)
