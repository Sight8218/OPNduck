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
| Desktop shell, NOW | **Electron** (pre-alpha/alpha) | Node toolchain already installed; fastest path to a runnable native app. Temporary. |
| Desktop shell, future | **Tauri v2** (beta/Release-Candidate) | Lower RAM, portability ("run on any PC"), tiny binaries. Must be a clean swap. |
| Framework | **React 19 + TypeScript + Vite** | Shared across web + desktop + both shells. |
| Styling | **Tailwind CSS v4** + CSS custom-property theme tokens | Theme switching via a single `data-theme` attribute. |
| Animation | **Framer Motion** + CSS keyframes | GPU-accelerated, cheap. |
| Foreground roadmap | Linux-first, **Windows-parallel from day 1**, macOS later | Dev happens on Linux (Arch). Cross-platform paths/scripts baked in. |
| Version | **v0.2.0-Pre-Alpha** | Shell/GUI/settings only. Bump to **v0.2.0-Alpha** the moment real download/convert works. |
| License | **GPL-3.0**, copyright **Aaron Jonsson 2026** | Actual LICENSE in repo + GPL header on every source file. |

**Version rule (user's, explicit):** Pre-Alpha = GUI + settings only. Alpha = at least
real video downloading works. Respect this.

---

## 3. Feature split (platform architecture)

**Universal (Web & Desktop):**
- Media Downloader — YouTube, TikTok, SoundCloud, Spotify; outputs MP4, MP3, MKV, MOV,
  FLAC, WAV; up to 8K.
- Format Converter — universal video/audio/image conversion.

**Desktop-exclusive (hardware intensive):**
- AI Video Interpolation (RIFE) — e.g. 24fps → 60fps.
- AI Video & Image Upscaling (Real-ESRGAN, NCNN-Vulkan) — up to 4×.
- Community Plugin Ecosystem — modular add-ons (auto-subtitle, metadata scrubbers, …).
- Hardware Allocation Engine — per-task resource assignment.

**Target native stack (future phases):** yt-dlp, FFmpeg (hw-accelerated), Real-ESRGAN,
RIFE, librosa (BPM), faster-whisper (subtitles). Python 3 "Master Engine" sidecar
(packaged via PyInstaller). **None of these are wired yet — they land in Alpha.**

---

## 4. Navigation & layout (implemented)

- **Frameless window** intent: custom draggable top area blends into the app (Electron
  `titleBarStyle: hidden` now, Tauri `decorated:false` at beta). Implemented via
  `.titlebar-drag` / `.titlebar-no-drag` CSS (`-webkit-app-region`).
- **Unified translucent top nav bar**: Home, Downloads, Plugins, Settings.
- **Home dashboard**: "Adaptive Card" grid generated from a feature registry — cards
  re-flow automatically as tools/plugins are added/removed.
- **Isolated Settings page**: separate route, houses UI Theme toggles + Hardware
  Allocation. Not mixed into the workspace.

Routes (React Router v7, `BrowserRouter`):
`/` (Home) · `/downloads` · `/plugins` · `/settings` · `*` → `/`.

---

## 5. Design system — "Liquid Glass" (implemented, the signature feature)

Files: `src/index.css` (primitives) + `src/themes/tokens.css` (theme tokens).

**Glass components (`.glass`):** heavy `backdrop-filter: blur(...) saturate(...)`,
translucent white tint, **1-px inner "light-catch" border** (`inset 0 0 0 1px
var(--glass-border-inner)`), soft drop shadow, subtle top highlight. Variants:
`.glass-strong`, `.glass-input`, `.glass-btn`.

**Fluid background:** fixed full-viewport animated warm blob layer (`.fluid-background`
+ `.fluid-blob-1..4`), `mix-blend-mode: screen`, animated morphing `border-radius`,
GPU-friendly transforms, respects `prefers-reduced-motion`.

**Theme engine (3 themes)** via `data-theme` on `<html>`:
- **glass** (default) — flagship translucent + blur + gradient.
- **flat** — no blur/gradient/transparency; solid dark flat colors; saves resources.
- **monochrome** — strict high-contrast black & white.

Every visual token is a CSS custom property. Components never change — only tokens do.
Persistence: `localStorage['opnduck.theme']`. Hook: `src/themes/useTheme.ts`.

Verified end-to-end (headless Chromium): theme switching retints correctly
(glass `#2b0704`, flat `#0d0806`, mono `#000`), nav blur `22px` in glass / `0px`
in flat+mono, all 4 routes render, zero JS errors.

---

## 6. Adaptive card system (implemented)

- `src/features/registry.ts` — `FeatureDefinition` type + `featureRegistry` array +
  `registerFeatures()`.
- `src/features/modules.ts` — `registerCoreFeatures()` seeds Downloader + AI Upscaler.
- `src/components/AdaptiveCardGrid.tsx` — renders one card per enabled feature, re-flows
  automatically.
- `src/components/FeatureCard.tsx` — shared card chrome (icon, title, tagline, scope
  badge, description, children body).
- Cards: `downloader/DownloaderCard.tsx` (URL + format + Run Task),
  `upscaler/UpscalerCard.tsx` (2×/3×/4× segmented control + Run Task). **UI stubs —
  non-functional by design this phase.**

A future plugin loader simply calls `registerFeatures()` again; cards appear without
layout changes.

---

## 7. Host / portability seam (implemented — critical for the Tauri swap)

`src/host/` is the single seam between UI and native shell:
- `src/host/platform.ts` — OS detection (linux/windows/macos/unknown), path separator,
  `isDesktop`, `dataDir`; browser fallback via UA.
- `src/host/index.ts` — `Host` interface (window controls, `pickFile`, future tasks).
  Currently a browser no-op adapter.

**Rule:** the React tree calls ONLY `host` for anything OS/native. Tauri migration =
write a Tauri adapter implementing the same interface; the UI never changes.

---

## 8. Navigation & portability specifics to preserve

- `vite.config.ts`: port `1420` strict, `TAURI_DEV_HOST` aware, `clearScreen:false`,
  ignores `**/desktop/**` + `**/src-tauri/**` in watch.
- `.gitignore` already covers Electron/Tauri builds, Python sidecar, installers.
- Cross-platform npm scripts exist (`dev`, `build`, `lint`, `preview`, `typecheck`);
  planned `dist:linux` / `dist:win` via **electron-builder** (decision captured; not
  yet added since the Electron shell is a later phase).

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

- Location: `/home/ducky/Work/opnduck/`
- Version: `0.2.0-pre-alpha`
- `npm run build`, `npm run lint` → **clean**. Dev server serves on `:1420`.
- Git repo initialized on `main`, files staged, **NO commit yet** (first build complete;
  ready for an initial commit).
- Source tree: see `history.md` §Current source layout for the exact file map.

---

## 12. How to pick up / continue

1. Read this brief + `history.md` + `personality.md`.
2. Suggested next milestones (in order): initial git commit → Electron shell (frameless
   window + host adapter) → wire yt-dlp download as the first *real* functional feature
   (bumps version to Alpha) → Converter (FFmpeg) → plugin loader → Tauri migration at
   beta.
3. Enqueue: command palette (Ctrl+K), per-card accent tints, accessibility/contrast
   alignment. See `history.md` §Ideas backlog.
