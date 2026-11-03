// Packs the terminal app as two npm packages from the same build:
//   release-build/npm/opnduck-tui-<version>.tgz             for the npm registry:    npm i -g opnduck-tui
//   release-build/npm/sight8218-opnduck-tui-<version>.tgz   for GitHub Packages:      npm i -g @sight8218/opnduck-tui
// Nothing is published here; see docs/TUI.md for the publish commands.
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

const root = JSON.parse(readFileSync('package.json', 'utf8'))
execFileSync('node', ['scripts/build-tui.mjs'], { stdio: 'inherit' })

const readme = `# OPNduck TUI

The OPNduck media tools in a terminal: download, convert, trim, upscale (image and video), frame interpolation,
subtitles and AI audio. About 100 MB of memory instead of about 680 MB, and it works over SSH.
It is the terminal version of [OPNduck](https://github.com/Sight8218/OPNduck), local-first and open source (GPL-3.0).

    npm install -g opnduck-tui
    opnduck-tui            # or: npx opnduck-tui
    opnduck-tui --help

Needs Node.js 20 or newer. Settings and history are shared with the desktop app. The tools it drives (ffmpeg, yt-dlp and the
optional AI engines) are installed separately; the Setup screen (key 5) shows what is missing and how to get it.
Full guide: https://github.com/Sight8218/OPNduck/blob/main/docs/TUI.md
`

const variants = [
  { dir: 'opnduck-tui', name: 'opnduck-tui', publishConfig: { access: 'public', tag: 'latest' } },
  { dir: 'sight8218-opnduck-tui', name: '@sight8218/opnduck-tui', publishConfig: { registry: 'https://npm.pkg.github.com', access: 'public', tag: 'latest' } },
]

rmSync('release-build/npm', { recursive: true, force: true })
for (const v of variants) {
  const stage = `release-build/npm/stage-${v.dir}`
  mkdirSync(stage, { recursive: true })
  for (const f of ['opnduck-tui.mjs', 'torch_upscale.py', 'demucs_separate.py', 'whisper_subtitles.py', 'beat_finder.py', 'bg_remove.py', 'dub.py', 'plugin_worker.cjs']) copyFileSync(`dist-tui/${f}`, `${stage}/${f}`)
  chmodSync(`${stage}/opnduck-tui.mjs`, 0o755)
  copyFileSync('LICENSE', `${stage}/LICENSE`)
  writeFileSync(`${stage}/README.md`, readme)
  writeFileSync(
    `${stage}/package.json`,
    JSON.stringify(
      {
        name: v.name,
        version: root.version,
        description: 'OPNduck in a terminal: download, convert, trim, upscale, interpolate, subtitles and AI audio.',
        license: root.license,
        author: root.author,
        homepage: 'https://github.com/Sight8218/OPNduck/blob/main/docs/TUI.md',
        repository: { type: 'git', url: 'git+https://github.com/Sight8218/OPNduck.git' },
        bugs: { url: 'https://github.com/Sight8218/OPNduck/issues' },
        keywords: ['opnduck', 'tui', 'terminal', 'ffmpeg', 'yt-dlp', 'upscale', 'media', 'cli'],
        type: 'module',
        bin: { 'opnduck-tui': 'opnduck-tui.mjs' },
        files: ['opnduck-tui.mjs', '*.py', 'README.md', 'LICENSE'],
        engines: { node: '>=20' },
        publishConfig: v.publishConfig,
      },
      null,
      2,
    ) + '\n',
  )
  const out = execFileSync('npm', ['pack', '--pack-destination', 'release-build/npm', `./${stage}`], { encoding: 'utf8' }).trim().split('\n').pop()
  console.log(`packed ${v.name} -> release-build/npm/${out}`)
}
