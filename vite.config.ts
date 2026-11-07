import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { visualizer } from 'rollup-plugin-visualizer'

const host = process.env.TAURI_DEV_HOST

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const analyze = mode === 'analyze'
  return {
  plugins: [
    react(),
    tailwindcss(),
    // Only for `npm run analyze`: writes dist-analyze/stats.html (a treemap of what is in each chunk). Never part of a normal build.
    ...(analyze ? [visualizer({ filename: 'dist-analyze/stats.html', template: 'treemap', gzipSize: true, brotliSize: true })] : []),
  ],

  // Relative asset base so the built app loads under `file://` in Electron
  // (absolute `/assets/...` would resolve to the filesystem root and 404).
  base: './',

  build: analyze ? { outDir: 'dist-analyze/build', emptyOutDir: true } : undefined,

  // Vite options tailored for desktop shell development (Electron now, Tauri later).
  // These keep the dev server portable and prevent it from obscuring host-side errors.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // Ignore the future desktop shell source dirs so Vite doesn't rebuild on them.
      ignored: ['**/desktop/**', '**/src-tauri/**'],
    },
  },
}
})
