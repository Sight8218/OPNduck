# OPNduck Session Save — Complete Context & Continuation Guide

## Project Overview
**OPNduck v0.3.2-Alpha** — Local-first media processing suite (Electron desktop application).

### Technology Stack
- **Frontend**: React 19 + TypeScript 7 + Vite 8
- **Styling**: Tailwind CSS v4 + CSS custom properties (theme tokens); JetBrains Mono font
- **Desktop Shell**: Electron 44 (Node.js, no Rust). Tauri v2 migration postponed (see below)
- **State Management**: React Context + hooks (NavProvider, DevModeProvider, motion prefs, `useTasks`)
- **Routing**: `HashRouter` (react-router-dom v7). `BrowserRouter` broke the packaged `file://` build
- **Animation**: Framer Motion
- **Icons**: `@tabler/icons-react`
- **Build Tool**: Vite with `base: './'`; packaging via electron-builder

### Design & Themes
- **Blarange** (default): flat, solid black + orange, no blur or translucency. This is the
  old Glass theme, renamed and flattened; "Liquid Glass" is retired.
- **Monochrome**: strict high-contrast black & white
- **Omarchy** (hidden): mirrors the live Omarchy desktop theme, shown only when Omarchy is detected
- The Flat theme was removed. Legacy names (`.glass`, `GlassSelect`, `--glass-*`, `--fluid-*`,
  `FluidBackground`) remain but render flat (0px blur, transparent fluid colors).

### Project Status
- **Version**: 0.3.2-Alpha (released 2026-10-10)
- **Working features**: Downloader (yt-dlp, incl. YouTube playlists), Converter (ffmpeg for
  video/audio/image, LibreOffice for documents), AI Image Upscaler + AI Video Upscaler
  (Real-ESRGAN), Frame Interpolation (RIFE). Tools are system binaries on PATH; cards are
  gated when a binary is missing.
- **Also shipped**: persistent job progress, drag & drop, Library history (Open folder, Run
  again, Clear finished), per-card presets, command palette (`Ctrl+K`), rebindable keybinds.
- **Not wired yet**: Beat Finder (librosa), Python sidecar, plugin loader
- **License**: GPL-3.0
- **Repository**: https://github.com/Sight8218/OPNduck (public, `main`)
- **Platform Focus**: Linux (X11/Wayland), Hyprland window manager; Windows builds made via
  wine and untested on real Windows

---

## Directory Structure

```
opnduck/
├── electron/
│   ├── main.cjs          # BrowserWindow, IPC handlers, task runner (yt-dlp/ffmpeg/LibreOffice/Real-ESRGAN/RIFE)
│   ├── preload.cjs       # IPC bridge (contextIsolation enabled)
│   └── omarchy.cjs       # Reads the live Omarchy desktop theme
├── src/
│   ├── App.tsx           # HashRouter, providers, splash hide, global drop guard
│   ├── main.tsx          # React entry point
│   ├── index.css         # Global CSS, Tailwind layers, primitives
│   ├── components/       # NavBar, CommandPalette, AdaptiveCardGrid, FeatureCard, PresetBar,
│   │                     # Smart*Panel, Settings cards (Theme, Motion, Keybinds, Storage, …)
│   ├── features/
│   │   ├── registry.ts   # FeatureDefinition + registerFeatures()
│   │   ├── modules.ts    # registerCoreFeatures(): the five core cards
│   │   ├── downloader/   # DownloaderCard
│   │   ├── converter/    # ConverterCard, FormatPickerModal, formats
│   │   ├── upscaler/     # ImageUpscalerCard, VideoUpscalerCard
│   │   └── interpolate/  # InterpolationCard
│   ├── pages/            # Home, Library, Plugins, Settings
│   ├── host/             # index.ts (Host interface), electron.ts (adapter), platform.ts
│   ├── lib/              # useTasks, usePresets, keybinds, navContext, devMode, motionPrefs, …
│   └── themes/           # tokens.css, theme.ts, useTheme.ts, omarchySync.ts
├── public/               # Static assets and icons
├── docs/                 # logo/, screenshots/
├── plugin-examples/      # Example plugin (loader not wired yet)        
├── index.html            # Vite entry HTML + startup splash
├── package.json          # Scripts + electron-builder config
├── vite.config.ts        # base './', port 1420
├── CHANGELOG.md          # Release notes (git-cliff)
├── PROJECT_BRIEF.md      # Durable project brief
├── PLUGINS.md            # Plugin authoring notes
├── SESSION_SAVE.md       # This file
└── history.md            # Early session-by-session log (Sessions 1–11)
```

---

## Past Bug Fix Still in Force (Session #11): Gray Window Frame

### Problem: Gray Window Frame
**Symptom**: A persistent `53,53,53` gray border (~2-4px) appeared on the left, right, and bottom edges of the OPNduck window.

### Investigation Process
The user suspected the gray frame was caused by:
1. The app's CSS/theme rendering
2. Hyprland window manager border settings
3. The glass theme's orange rendering

### Systematic Diagnosis: Layer-by-Layer Stripping
To isolate the source, we methodically removed app layers one at a time, checking the frame after each removal:

1. **Layer 1**: Removed panels/cards (AdaptiveCardGrid, PreAlphaBanner, VersionFooter) → Frame persisted
2. **Layer 2**: Removed NavBar component → Frame persisted
3. **Layer 3**: Removed scrollbar (not present in this version) → Skipped
4. **Layer 4**: Disabled `backdrop-filter: blur()` on `.glass` class → Frame persisted
5. **Layer 5**: Hidden fluid blobs (`opacity: 0` on `.fluid-blob`) → Frame persisted
6. **Layer 6**: Removed `<FluidBackground />` component entirely → Frame persisted
7. **Layer 7**: Set `body { background-color: transparent }` in `src/index.css` → Frame persisted
8. **Layer 8**: Set `index.html` inline `<style>` body background to transparent → Frame persisted
9. **Layer 9**: Set Electron `backgroundColor: '#00000000'` + **`transparent: true`** → **Frame ELIMINATED**

### Root Cause
The gray frame was a **Chromium frameless window compositor edge** on X11/XWayland. Frameless Electron windows (`frame: false`) without the `transparent: true` flag get a thin compositor-drawn border artifact.

**NOT caused by**:
- Hyprland (proven via Tokyo Night theme comparison showing blue border on other apps)
- App CSS (proven via complete content stripping)
- Theme rendering (proven via full glass theme neutralization test)

### The Fix
**File**: `electron/main.cjs`

Added `transparent: true` to the BrowserWindow constructor:

```javascript
const win = new BrowserWindow({
  width: 1280,
  height: 820,
  minWidth: 940,
  minHeight: 600,
  title: 'OPNduck',
  transparent: true,              // ← THIS FIX
  backgroundColor: '#00000000',
  frame: false,
  titleBarStyle: 'hidden',
  autoHideMenuBar: true,
  webPreferences: {
    preload: path.join(__dirname, 'preload.cjs'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  },
})
```

**Result**: Gray frame completely eliminated. Window now truly transparent with no compositor edge.

---

## Current Working State

### Electron Configuration
- **File**: `electron/main.cjs`
- **Window**: 1280×820, min 940×600 (enforced in a `will-resize` handler because
  `minWidth`/`minHeight` are unreliable on frameless transparent windows), `frame: false`,
  `titleBarStyle: 'hidden'`, `transparent: true`, `backgroundColor: '#00000000'`,
  `sandbox: true`, `contextIsolation: true`
- **Packaged build** loads the UI with `win.loadFile()` (a bare path in `loadURL()` opened a
  blank window on Electron 44.7, the v0.3.0 bug fixed in v0.3.1)
- A Content-Security-Policy is set; only `http(s)` links are accepted and IPC requests are validated

### Theme System
- **Files**: `src/themes/tokens.css`, `theme.ts`, `useTheme.ts`, `omarchySync.ts`
- **Themes**: `blarange` (default), `monochrome`, hidden `omarchy`
- **Application**: `data-theme` on `<html>`, persisted in `localStorage['opnduck.theme']`
- **Switching**: `applyTheme(theme)` in `src/themes/theme.ts`

### Development
- `npm run desktop:dev`: Vite on `http://localhost:1420` + Electron, with HMR
- `npm run dev`: Vite only (UI runs in a browser with a no-op host)

### Build & Packaging
- `npm run typecheck`, `npm run lint` (oxlint), `npm run build` (`tsc -b && vite build`)
- `npm run desktop:build` / `desktop:start`
- `npm run dist:linux` (AppImage + pacman), `dist:win` (NSIS + portable), `dist` (both)
- No automated test suite

---

## Development History (Summary)

- **Sessions 1–11** (see `history.md`): v0.2.0 frontend foundation, theme system, Dev mode,
  scrollbar/menu fixes, gray-frame fix.
- **v0.2.0-Alpha**: first real feature, yt-dlp downloads.
- **v0.3.0-Alpha**: rebuilt multi-format Converter, YouTube playlists, AI upscaler and
  interpolation cards, rebindable keybinds, Omarchy theme, Glass → Blarange (flat),
  audit hardening. Packaged builds opened blank.
- **v0.3.1-Alpha**: hotfix for the blank packaged window; batch/cancel fixes; CSP.
- **v0.3.2-Alpha**: persistent job progress, drag & drop, Library history with re-run, presets.
- Since then on `main`: keyboard-shortcut fix for Ctrl combos (palette default `Ctrl+K`),
  Subtitles card wired to faster-whisper, Windows fixes (LibreOffice lookup, yt-dlp UTF-8),
  Windows smoke-test workflow, Flat/Gradient background setting (flat default), notify-only
  update check, dependency refresh.

See `CHANGELOG.md` for details.

---

## Key Design Decisions (Locked)

1. **Electron now; Tauri postponed** → A full Tauri v2 migration was built but is on hold:
   WebKitGTK on Linux + NVIDIA proprietary driver + Wayland can't do hardware compositing
   (upstream bug). The work is on a local `tauri-migration-phase1` branch, not pushed to GitHub.
2. **Tailwind v4 + CSS Custom Properties** → Theme switching via one `data-theme` attribute
3. **Linux-First, Windows-parallel** → macOS later
4. **Version rule** → Pre-Alpha = GUI + settings only; Alpha = real downloading works
5. **Frameless Window** → Custom window controls; `frame: false` with transparent background
6. **HashRouter** → Required for the packaged `file://` build
7. **Vite `base: './'`** → Assets load from relative path
8. **Host seam** → The React tree calls only `src/host` for native work
9. **Hyprland Integration** → Window class `opnduck-desktop` for WM rules; do NOT edit
   Hyprland config without explicit user approval

---

## Hyprland Configuration (User Constraints)

**File**: `~/.config/hypr/hyprland.lua`

**User Directive**: "DO NOT TOUCH HYPRLAND except for the OPNduck window rule."

**Current Rule** (added during investigation, benign):
```lua
o.window("opnduck-desktop", { border_size = 0 })
```
This removes Hyprland's window border for OPNduck only. It does NOT affect other apps and is safe to keep.

**Why it's there**: During the frame investigation, we verified that Hyprland's border (`#8d8d8d` blue or `#595959` gray) was NOT the source. This rule was added to eliminate Hyprland's border (which worked), but the gray frame persisted until `transparent: true` was applied to Electron.

---

## Testing & Verification Protocol

After making changes, verify:

1. **Build Success**: `npm run typecheck`, `npm run lint`, `npm run build`
2. **Dev Server**: `npm run desktop:dev` (app launches without crashes)
3. **Packaged build** for Electron-side changes: `npm run dist:linux` and launch the AppImage
   (dev mode hid the v0.3.0 blank-window bug)
4. **Visual Check**: switch themes (Blarange, Monochrome), check window edges, navigate pages
5. **Console**: No errors or warnings

---

## Next Steps (For Continuation)

1. Beat Finder (librosa) engine
2. Python "Master Engine" sidecar and the plugin loader
3. Test Windows builds on real Windows
4. AUR publication and artifact signing (deferred)
5. Revisit Tauri only when the WebKitGTK/NVIDIA/Wayland issue is fixed upstream
6. **Keep Hyprland untouched** unless explicitly directed otherwise

---

## Continuation Instructions for Next AI Session

**You are continuing OPNduck development.** The user builds this app systematically and is
methodical, thorough, and test-driven.

### Tone & Style
- **Not impatient**: Take time to understand context before suggesting changes
- **Methodical**: Follow the user's preferred workflow (layer stripping, pixel verification, systematic testing)
- **Transparent**: Explain reasoning; show results visually (screenshots, pixel scans)
- **Efficient**: Use tools effectively (pixel scanners, layer-by-layer debugging) rather than guessing

### Key Behaviors
1. **DO NOT EDIT HYPRLAND** without explicit user request (user has strong directive)
2. **Follow user's chosen options** — don't propose unilaterally; let them decide
3. **Use proven debugging methods**: Layer stripping, pixel verification, systematic testing
4. **Assume continuity** — understand all prior sessions; don't ask "what happened before"
5. **Keep `transparent: true` in Electron** — this is the fix for the gray frame
6. **Test themes & visuals after changes** — verify no regression
7. **Commit with clear messages** — reference what was fixed and why

### Preferred Workflow (Based on Session #11)
- When investigating a visual issue: capture screenshots, use pixel scanners, strip layers methodically
- When implementing CSS/theme changes: test across Blarange and Monochrome (and Omarchy if available)
- When making Electron changes: restart the app to apply; note which changes require restart vs HMR
- When stuck: step back, gather data, systematically test hypotheses

---

**Last Updated**: October 17, 2026 (v0.3.2-Alpha + unreleased changes on `main`)
**Next Session Starter**: Read `PROJECT_BRIEF.md` and `CHANGELOG.md`, then continue with the next steps above
