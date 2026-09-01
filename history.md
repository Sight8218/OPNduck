# OPNduck — Session History

> Auto-save point created when conversation context was ~50% (limits) to guarantee no
> knowledge is lost on compaction or when switching models. Read `PROJECT_BRIEF.md`
> for architecture, `personality.md` for working style, and this file for what actually
> happened and what's agreed next.

---

## Session timeline

### 1. Crash diagnosis (unrelated to OPNduck — done & closed)
- User reported a Brave renderer crash (SIGILL, PID 286504) via the `diagnose-crash`
  skill.
- **Findings:** Brave *renderer* sub-process died with SIGILL (ILL_ILLOPN "invalid
  opcode") inside `/opt/brave-origin-bin/brave` (stripped binary, frames unsymbolized).
  Most likely a V8 JIT bug or renderer memory corruption. **Not** OOM, not a repeated
  pattern, not hardware (i7-4770K has no MCE). No permanent data loss (renderer crash
  → tab restore). **Not an Omarchy bug** — Brave's own binary; report upstream to Brave
  if it recurs. Closed.

### 2. "Can you make apps?" → design doc → OPNduck v0.2.0
- User confirmed I can build apps, then pointed me to
  `/home/ducky/promptforOPNducky.txt` (the OPNduck design document) and told me to study
  it and bring ideas, "you're my bro".

### 3. Environment reconnaissance
- Machine: Arch Linux, **Node v26.7.0**, npm 11.19, **no Rust toolchain**.
- **NVIDIA RTX 3080 10GB, CUDA 13.3**, working `nvidia-smi` (great for future AI work).
- `ffmpeg n9.0.1`, `yt-dlp`, `gcc`, `make` present. Python 3.14.
- These facts drove the Electron-now / Tauri-at-beta decision.

### 4. Framework decision (user-driven)
- I recommended Electron (installed Node, no Rust). User originally picked Electron,
  then **overrode**: wants **Tauri eventually** for low RAM + portability, but agreed to
  **Electron temporarily through pre-alpha/alpha, switching to Tauri at beta/RC**.
- Locked via `question` tool: **Electron** (now), **Tailwind v4 + CSS vars**,
  **frontend foundation first**.

### 5. Researched the existing OPNduck v0.1.0
- Files in `/home/ducky/OPNduck-plans-and-things/`:
  - README + release notes (v0.1.0 was also **shell-only, no functionality**).
  - **GPL-3.0** LICENSE (copyright Aaron Jonsson 2026) — despite README mentioning an
    "OLOS" license, the actual commit is GPL-3.0. We used GPL-3.0.
  - Old Windows installer `opnduck-desktop_0.1.0_x64_en-US.msi` (WiX/x64 MSI — reference
    only, can't run on Linux).
  - v0.1.0 was **Tauri v2** + React 19 + Tailwind v4 + Python sidecar.
- User specified: this rebuild = **v0.2.0-Pre-Alpha** (shell/settings only), bump to
  **v0.2.0-Alpha** only if real download works. Linux-first + Windows-parallel.

### 6. Built the v0.2.0 frontend foundation
Location: `/home/ducky/Work/opnduck/`

**Scaffold:** Vite `react-ts` → added `tailwindcss`+`@tailwindcss/vite`, `react-router-dom`,
`framer-motion`. Set dev port 1420.

**Files created:**
- `index.html` — OPNduck title + reused v0.1 splash screen; `public/favicon.svg` custom.
- `src/index.css` — global CSS: `.glass`, `.glass-strong`, `.glass-input`, `.glass-btn`,
  `.fluid-background` + `.fluid-blob-1..4`, `.titlebar-drag/.no-drag`, focus-visible ring.
- `src/themes/tokens.css` — theme token blocks for `glass` / `flat` / `monochrome`.
- `src/themes/theme.ts` + `useTheme.ts` — `data-theme` engine + localStorage persist.
- `src/host/platform.ts` + `index.ts` — portability seam (OS detect + `Host` interface).
- `src/components/` — `NavBar`, `FluidBackground`, `AdaptiveCardGrid`, `FeatureCard`,
  `ThemeToggle`, `HardwareAllocation`.
- `src/features/` — `registry.ts`, `modules.ts`, `downloader/DownloaderCard.tsx`,
  `upscaler/UpscalerCard.tsx`, `converter/` (empty for now).
- `src/pages/` — `Home`, `Downloads`, `Plugins`, `Settings`.
- `src/App.tsx` — routing + splash hide + theme pre-apply; `main.tsx` entry.
- `README.md` — rewritten for v0.2.0 (kept brand + 7 modules + AI transparency note).
- `LICENSE` — GPL-3.0 copied from plans folder.
- GPL header added to **all 22 source files**.
- `.gitignore` extended for Electron/Tauri/Python future.
- `package.json` — name `opnduck-desktop`, version `0.2.0-pre-alpha`, license GPL-3.0.

**Verification (all passed):** `npm run build` ✓, `npm run lint` (oxlint) ✓, headless
Chromium E2E ✓ — all 4 routes render, theme switching retints correctly
(glass `#2b0704` + blur `22px`, flat `#0d0806`, mono `#000`), 2 cards render, 0 JS errors.
Screenshots: `/tmp/opnduck-{glass,flat,monochrome}.png`. Git repo initialized on
`main`, files staged, **not yet committed**.

### 7. Current open items
- **User is reviewing the 3 theme screenshots** (opened on his screen) — he'll give
  visual feedback next.
- No git commit has been made yet for the first build (offer was made, not answered).

### 8. Live UI feedback round (gradient + glass + Dev mode)
- **User is reviewing live at `http://localhost:1420`** and giving piecemeal visual fixes.
- **Gradient cutoff bug** (see `/home/ducky/OPNduck-plans-and-things/gradient-bug.txt`):
  top was solid dark, only the bottom had the gradient. Root cause located via the user's
  **debug-color troubleshooting idea**: every solid `#1f0508` was repainted to a unique
  color (blue = `--bg-base`, green = html, red = btn-text). `--bg-base` turned the whole
  viewport flat blue → it was the flood.
- **Fix**: `--bg-base` is now a **continuous vertical gradient** (`#1d0c0f → #150305 →
  #230e11 → #150305`), `--fluid-*` colors brightened, 6 blobs re-spread full-viewport +
  a new `.fluid-blob-6`, removed the darkening `linear-gradient` bands in `::before`.
- **Wordmark fix**: moved the gradient + `background-clip: text` off the parent (where a
  `drop-shadow` filter caused a "solid gradient rectangle" render) **onto each span**;
  glow stays on the parent via `filter: drop-shadow`.
- **Slide animation**: rewrote `PageTransition` using a ref-based pre-read (no state
  re-renders → no flicker) plus a soft `blur(6px)->blur(0)` motion-blur on enter/exit.
- **Glass opacity**: bumped `--glass-bg` 0.6→0.65, `--glass-bg-strong` 0.72→0.78 for
  legibility.
- **Baked user preset** (tuned with temp sliders): `dark:33, scrim:20, blob:-47, panels:65`
  → `--bg-base` darkened gradient, `--bg-scrim: rgba(0,0,0,0.2)`, `--fluid-opacity: 0.23`,
  `--glass-bg: rgba(69,39,42,0.65)`.

### 9. DEV / DEBUG mode (new)
- **`src/lib/devMode.tsx`**: `DevModeProvider` + `useDevMode`, persisted to localStorage
  (`opnduck.devmode`), **fixed non-changeable keybind `Ctrl+Shift+D`** (README-stable for
  now). Keybindings menu is planned later (app must be fully key-navigable for Omarchy).
- **No visible toggle** — dev mode is keybind-only, as requested. Settings got a **new
  "Keybinds" category** (Tabler `IconKeyboard`) listing the dev-mode bind as
  non-changeable, with a note that changeable binds ship with the keybindings menu later.
  Nav order: Appearance, Keybinds, System, About.
- **`GlassTune.tsx`** (temp backdrop tuning, 4 sliders: dark/scrim/blob/panels + copyable
  preset code) is **gated behind devMode** so the UI stays clutter-free.
- Verified via headless E2E: baked values apply (`--glass-bg` 0.65, gradient base, blob
  opacity 0.23, scrim 0.2), GlassTune hidden by default, `Ctrl+Shift+D` toggles on/off,
  4 nav categories render, no visible Developer toggle.

---

## Agreed roadmap (from the user + me)

**In session now:**
- Add to the app: **command palette (Ctrl+K)**, **per-card accent tints**, and an
  **accessibility pass** (wire Monochrome to `prefers-contrast`, honor
  `prefers-reduced-motion`). All three were proposed by me; user said "yes we should add
  all of those" — **enqueue and do them after screenshots are reviewed.**

**Later phases (order proposed):**
1. Initial git commit of the foundation.
2. Electron shell (frameless window + `host` adapter + electron-builder for
   `dist:linux`/`dist:win`).
3. Wire **yt-dlp download** as the first real functional feature → **bump to
   v0.2.0-Alpha** (per the version rule).
4. Format Converter (FFmpeg).
5. Community plugin loader (appends `FeatureDefinition`s → cards appear automatically).
6. Hardware Allocation wiring to real backends.
7. **Tauri migration at beta/RC** (swap the `host` adapter; UI unchanged).

---

## Current source layout

```
opnduck/
  index.html            # splash + entry
  package.json          # opnduck-desktop 0.2.0-pre-alpha
  vite.config.ts        # port 1420, TAURI_DEV_HOST, tailwind
  LICENSE               # GPL-3.0 (Aaron Jonsson 2026)
  README.md             # v0.2.0 rewrite
  PROJECT_BRIEF.md      # this save-point's sibling (read first)
  personality.md
  history.md            # this file
  public/favicon.svg
  src/
    main.tsx  App.tsx
    index.css           # .glass, fluid bg, drag regions
    themes/   tokens.css, theme.ts, useTheme.ts
    host/     platform.ts, index.ts
    components/  NavBar, FluidBackground, AdaptiveCardGrid, FeatureCard,
                 ThemeToggle, HardwareAllocation
    features/  registry.ts, modules.ts,
               downloader/DownloaderCard.tsx, upscaler/UpscalerCard.tsx, converter/
    pages/     Home, Downloads, Plugins, Settings
```

---

## Ideas backlog (from me, all pre-approved to explore)

1. **Command palette (Ctrl+K)** — glass-styled spotlight search over tools/plugins. High
   value, cheap. APPROVED.
2. **Per-card accent tints** — subtle per-feature color so desktop/hardware cards feel
   distinct. APPROVED.
3. **Accessibility** — Monochrome to `prefers-contrast`, honor reduced-motion (partially
   implemented). APPROVED.
4. Future: download queue UI, task progress, plugin marketplace, Windows packaging.
