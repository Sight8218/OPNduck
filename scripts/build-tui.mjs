// Bundles the terminal app (tui/) and the job core (electron/core) into one file, dist-tui/opnduck-tui.mjs,
// and copies the Python helper scripts next to it. Needs Node 20 or newer to run.
import { build } from 'esbuild'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'

mkdirSync('dist-tui', { recursive: true })
writeFileSync('dist-tui/.devtools-stub.js', 'export default {}\n')
await build({
  entryPoints: ['tui/main.jsx'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist-tui/opnduck-tui.mjs',
  jsx: 'automatic',
  loader: { '.ts': 'ts' },
  alias: { 'react-devtools-core': './dist-tui/.devtools-stub.js' },
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
})
for (const py of ['torch_upscale.py', 'demucs_separate.py', 'whisper_subtitles.py']) copyFileSync(`electron/${py}`, `dist-tui/${py}`)
copyFileSync('electron/core/plugin_worker.cjs', 'dist-tui/plugin_worker.cjs') // loaded as a worker by path, so the bundler cannot include it
