// Bundles the terminal app (tui/) into dist-tui/opnduck-tui.mjs. The job core (electron/core/*.cjs) is not
// bundled: it is loaded at run time next to this file, so it can find its Python scripts.
import { build } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'

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
