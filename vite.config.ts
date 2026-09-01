import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const host = process.env.TAURI_DEV_HOST

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],

  // Relative asset base so the built app loads under `file://` in Electron
  // (absolute `/assets/...` would resolve to the filesystem root and 404).
  base: './',

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
})
