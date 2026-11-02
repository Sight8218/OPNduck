// Bundles OPNduck Server (server/) and the job core (electron/core) into one file, dist-server/opnduck-server.cjs,
// and copies the helper scripts next to it. Needs Node 20 or newer to run.
import { build } from 'esbuild'
import { copyFileSync, mkdirSync } from 'node:fs'

mkdirSync('dist-server', { recursive: true })
await build({
  entryPoints: ['server/main.cjs'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'dist-server/opnduck-server.cjs',
  banner: { js: '#!/usr/bin/env node' },
  logLevel: 'info',
})
for (const py of ['torch_upscale.py', 'demucs_separate.py', 'whisper_subtitles.py']) copyFileSync(`electron/${py}`, `dist-server/${py}`)
copyFileSync('electron/core/plugin_worker.cjs', 'dist-server/plugin_worker.cjs')
