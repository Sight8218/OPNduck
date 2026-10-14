# OPNduck — Project Brief

> **Stop here first.** This file is the durable memory of the OPNduck project. It
> summarizes the product, all architecture decisions, and the exact state of the
> codebase. Read this before making changes; read `history.md` and
> `personality.md` for session + working-style context.

---

## 1. What OPNduck is

A **local-first, premium, subscription-free media processing ecosystem**. All media
stays on the machine; no cloud, no spying, no cost. Two environments share one
frontend:

- **Lightweight web app** — basic tasks (download, convert).
- **Powerhouse desktop app** — uses the local CPU/GPU to its maximum for heavy AI
  processing (upscaling, frame interpolation).

Current title/identity: **"OPNduck Desktop Suite"** 🦆, warm gradient branding
(yellow `#fef08a` → orange `#f97316` → red `#ef4444`).

---

## 2. Non-negotiable decisions (locked-in)

| Decision | Choice | Why |
| -------- | ------ | --- |
| Desktop shell, NOW | **Electron** (alpha) | Node toolchain already installed; fastest path to a runnable native app. |
| Desktop shell, future | **Tauri v2**, **postponed** | Lower RAM, tiny binaries. A full migration was built but is on hold: WebKitGTK on Linux + NVIDIA proprietary driver + Wayland can't do hardware compositing (upstream bug). That work lives on a local `tauri-migration-phase1` branch that is not pushed to GitHub. |
| Framework | **React 19 + TypeScript + Vite** | Shared across web + desktop + both shells. |
| Styling | **Tailwind CSS v4** + CSS custom-property theme tokens | Theme switching via a single `data-theme` attribute. |
| Animation | **Framer Motion** + CSS keyframes | GPU-accelerated, cheap. |
| Foreground roadmap | Linux-first, **Windows-parallel from day 1**, macOS later | Dev happens on Linux (Arch). Cross-platform paths/scripts baked in. |
| Version | **v0.3.2-Alpha** | Persistent job progress, drag & drop, history, presets; Tauri migration postponed. |
| License | **GPL-3.0**, copyright **Aaron Jonsson 2026** | Actual LICENSE in repo + GPL header on every source file. |

**Version rule (user's, explicit):** Pre-Alpha = GUI + settings only. Alpha = at least
real video downloading works. Respect this.

---

## 3. Feature split (platform architecture)

**Universal (Web & Desktop):**
- Media Downloader — YouTube, TikTok, SoundCloud; outputs MP4, MP3, MKV, MOV,
  FLAC, WAV; up to 8K. (Not Spotify — DRM-protected, no legitimate extraction path.)
- Format Converter — universal video/audio/image conversion.

**Desktop-exclusive (hardware intensive):**
- AI Video Interpolation (RIFE) — e.g. 24fps → 60fps.
- AI Video & Image Upscaling (Real-ESRGAN, NCNN-Vulkan) — up to 4×.
- Community Plugin Ecosystem — modular add-ons (auto-subtitle, metadata scrubbers, …).
- Hardware Allocation Engine — per-task resource assignment.

**Native stack status (v0.3.2-Alpha):**
- **Wired** (system binaries on PATH, spawned from `electron/main.cjs`): yt-dlp
  (downloads + YouTube playlists), FFmpeg (video/audio/image conversion),
  LibreOffice (document conversion), Real-ESRGAN NCNN-Vulkan (image + video
  upscaling), RIFE NCNN-Vulkan (frame interpolation).
- **Not wired yet:** librosa (Beat Finder), faster-whisper (Subtitles), the
  Python 3 "Master Engine" sidecar (PyInstaller), the plugin loader.

---

## 4. Navigation & layout (implemented)

- **Frameless window** intent: custom draggable top area blends into the app (Electron
  `titleBarStyle: hidden` now, Tauri `decorated:false` at beta). Implemented via
  `.titlebar-drag` / `.titlebar-no-drag` CSS (`-webkit-app-region`).
- **Unified top nav bar**: Home, Library, Plugins, Settings (display mode configurable
  in Settings; hamburger menu variant).
- **Home dashboard**: "Adaptive Card" grid generated from a feature registry — cards
  re-flow automatically as tools/plugins are added/removed.
- **Library page**: persistent job history (survives relaunch) with Open folder,
  Run again and Clear finished.
- **Isolated Settings page**: separate route with a category sidebar: Appearance
  (theme, nav display, motion & density), Keybinds, System (Hardware Allocation,
  Storage), About.
- **Command palette** (default `Ctrl+K`, rebindable) and Dev mode (`Ctrl+Shift+D`).

Routes (React Router v7, **`HashRouter`**, because `BrowserRouter` can't resolve routes
when the packaged app loads `index.html` over `file://`):
`/` (Home) · `/library` · `/plugins` · `/settings` · `*` → `/`.

---

## 5. Design system (implemented)

Files: `src/index.css` (primitives) + `src/themes/tokens.css` (theme tokens) +
`src/themes/theme.ts` / `useTheme.ts` (switching).

The original "Liquid Glass" look (blur, translucency, animated fluid blobs) was
**retired**: the Glass theme was renamed **Blarange** and flattened, and the Flat theme
was removed. Names like `.glass`, `GlassSelect` and the `--glass-*` / `--fluid-*`
tokens remain for historical reasons; in the current themes blur is `0px` and the
fluid colors are `transparent`. UI font is JetBrains Mono.

**Theme engine** via `data-theme` on `<html>`:
- **blarange** (default): flat, solid black + orange, matching the marketing site's
  palette (`#e1892f`/`#f0a63b` orange, `#17130f` warm black, `#ede6d9` cream text).
- **monochrome**: strict high-contrast black & white.
- **omarchy** (hidden): "Synced with Omarchy", mirrors the Linux desktop's live
  Omarchy theme (`electron/omarchy.cjs` + `src/themes/omarchySync.ts`). Only offered
  when Omarchy is detected.

Every visual token is a CSS custom property. Components never change, only tokens do.
Persistence: `localStorage['opnduck.theme']`.

---

## 6. Adaptive card system (implemented)

- `src/features/registry.ts`: `FeatureDefinition` type + `featureRegistry` array +
  `registerFeatures()`.
- `src/features/modules.ts`: `registerCoreFeatures()` seeds the five core cards.
- `src/components/AdaptiveCardGrid.tsx`: renders one card per enabled feature in
  equal-height rows, re-flows automatically.
- `src/components/FeatureCard.tsx`: shared card chrome.
- Cards (all **functional**, gated when their binary is missing):
  `downloader/DownloaderCard.tsx`, `converter/ConverterCard.tsx` (+ format picker),
  `upscaler/ImageUpscalerCard.tsx`, `upscaler/VideoUpscalerCard.tsx`,
  `interpolate/InterpolationCard.tsx`.
- Cards support drag & drop (files, or a link onto the Downloader) and per-card
  presets (`PresetBar`, `src/lib/usePresets.ts`). Job progress is held app-wide
  (`src/lib/useTasks.ts`), so it survives navigating away.

A future plugin loader simply calls `registerFeatures()` again; cards appear without
layout changes. See `PLUGINS.md`.

---

## 7. Host / portability seam (implemented — critical for the Tauri swap)

`src/host/` is the single seam between UI and native shell:
- `src/host/platform.ts` — OS detection (linux/windows/macos/unknown), path separator,
  `isDesktop`, `dataDir`; browser fallback via UA.
- `src/host/index.ts`: `Host` interface (window controls, file/folder pickers, tool
  checks, `tasks` for start/cancel/rerun/history) with a browser no-op fallback.
- `src/host/electron.ts`: the Electron adapter, talking to `electron/preload.cjs` and
  the IPC handlers in `electron/main.cjs` (`tasks:start`, `tasks:startConvert`,
  `tasks:startUpscale`, `tasks:startVideoUpscale`, `tasks:startInterpolate`, …).

**Rule:** the React tree calls ONLY `host` for anything OS/native. Tauri migration =
write a Tauri adapter implementing the same interface; the UI never changes.

---

## 8. Navigation & portability specifics to preserve

- `vite.config.ts`: port `1420` strict, `TAURI_DEV_HOST` aware, `clearScreen:false`,
  ignores `**/desktop/**` + `**/src-tauri/**` in watch.
- `.gitignore` already covers Electron/Tauri builds, Python sidecar, installers.
- Cross-platform npm scripts: `dev`, `build`, `lint` (oxlint), `preview`, `typecheck`,
  `desktop:dev`, `desktop:build`, `desktop:start`, and packaging via
  **electron-builder**: `dist:linux` (AppImage + pacman), `dist:win` (NSIS + portable),
  `dist` (both). Windows builds are made from Linux via wine and are untested on Windows.

---

## 9. Splash screen

Reused from v0.1.0 (brand continuity) in `index.html`: dark `#08030a` full-screen
loader, warm-gradient "OPNDUCK" logo + animated progress bar. `App.tsx` fades it out on
mount (`hideSplash()`).

---

## 10. Licensing

- `LICENSE` = full **GNU GPL v3.0**, copyright **Aaron Jonsson 2026**.
- Every `.ts`/`.tsx`/`.css` source file carries the GPL header notice.
- README carries the honest transparency note: project made with AI/vibe-coding by a
  single developer; contributions welcome unpaid.

---

## 11. Current repo state

- Location: `/home/ducky/Work/opnduck/` · GitHub: `Sight8218/OPNduck` (`main`).
- Version: **`0.3.2-alpha`** (released 2026-10-10; see `CHANGELOG.md`).
- Electron 44, React 19, TypeScript 7, Vite 8, Tailwind 4.
- `npm run build`, `npm run typecheck`, `npm run lint` are expected to be clean. No
  automated test suite; GitHub workflows are Claude Code + Claude code review.
- Audit notes: `.claude/audit-log.md`. Source tree: see `src/` (the map in
  `history.md` predates v0.3).

---

## 12. How to pick up / continue

1. Read this brief + `CHANGELOG.md` + `history.md` + `personality.md`.
2. Open items: Beat Finder (librosa), Subtitles (faster-whisper), Python sidecar,
   plugin loader, testing the Windows builds on real Windows, AUR publication and
   artifact signing (deferred).
3. Tauri stays postponed until the WebKitGTK/NVIDIA/Wayland issue is fixed upstream,
   or if packaging only for Windows (WebView2) / non-NVIDIA Linux.
