import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { render } from 'ink'
import App from './App.jsx'
import { createCore } from '../electron/core/index.cjs'
import { createNodePlatform } from '../electron/core/platform.cjs'
import pkg from '../package.json'
import { makeTheme, themeNames } from './theme.js'

const HELP = `OPNduck TUI: the same tools as the desktop app, in a terminal.

  opnduck-tui [options]

Options
  --theme <name>             colours: ${themeNames().slice(0, 6).join(', ')}, ... (default blarange; also OPNDUCK_THEME)
  --screen <tools|queue>     the screen to open on
  --start <channel> <json>   start a job when it opens (repeatable), e.g.
                             --start tasks:startConvert '{"inputPath":"/a.mp4","container":"MKV"}'
  -h, --help                 this text

Keys: tab switches screens, q quits. Each screen lists its own keys at the bottom.`

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
if (args.includes('-h') || args.includes('--help')) {
  console.log(HELP)
  process.exit(0)
}

// The job core is bundled into this file; the Python helper scripts sit next to it (see scripts/build-tui.mjs).
const here = path.dirname(fileURLToPath(import.meta.url))

const platform = createNodePlatform({ version: pkg.version, scriptsDir: here })
const core = createCore({
  platform,
  onFinished: (state) => {
    if (!core.settings.getSettings().notifyOnFinish) return
    platform.notify({ title: state.status === 'done' ? 'OPNduck: finished' : 'OPNduck: a job failed', body: state.label })
  },
})
core.engine.loadHistory()
core.engine.applyQueueLimits()

for (let i = 0; i < args.length; i++) {
  if (args[i] !== '--start') continue
  try {
    await core.startJob(args[i + 1], JSON.parse(args[i + 2]))
  } catch (err) {
    console.error(`--start ${args[i + 1]}: ${err.message}`)
    process.exit(1)
  }
}

const theme = makeTheme(flag('--theme') ?? process.env.OPNDUCK_THEME ?? 'blarange')
const start = flag('--screen') === 'queue' || args.includes('--start') ? 'queue' : 'home'
const app = render(<App core={core} theme={theme} start={start} />)
await app.waitUntilExit()
process.exit(0)
