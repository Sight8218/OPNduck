# Changelog

All notable changes to OPNduck are documented in this file. Generated with
[git-cliff](https://github.com/orhun/git-cliff) from Conventional Commit
history; entries are curated for readability.

## [Unreleased]

### Added

- **Subtitles card** wired to faster-whisper (uses your own Python 3 with `faster-whisper`
  installed; set `OPNDUCK_PYTHON` to point at a venv).
- **Background setting** (Settings → Appearance): **Flat** is now the default; **Gradient**
  restores the theme's fade. In flat mode cards are lifted slightly so they never blend
  into the page.
- **Update check** (notify-only): on launch OPNduck asks GitHub whether a newer release
  exists and offers Download / Later / Skip this version; Settings → System → Updates has an
  on/off switch and Check now. Nothing is installed automatically.
- Windows smoke-test GitHub workflow (`windows-smoke.yml`).

### Changed

- Command palette default shortcut is now **Ctrl+K** (existing rebinds are untouched).
- Dependency refresh (Electron, framer-motion, oxlint).

### Performance

- Removed the per-card `backdrop-filter` (a no-op blur that cost a compositing layer on every
  card), the six animated blurred background blobs (invisible but still drawn every frame) and
  the whole-page blur animation on page switches. Measured on the packaged UI: idle ~103 → ~200
  fps, scrolling ~97 → ~199 fps, page switching ~60 → ~160 fps.
- Job-progress updates are coalesced (max one per 120 ms) so a running upscale no longer
  re-renders every card dozens of times a second.
- Removed unused theme tokens, dead code and a leftover platform helper.

### Fixed

- Keyboard shortcuts with Ctrl no longer miss letters/Space on input methods and non-US
  layouts (shortcuts read the physical key).
- Windows: LibreOffice is found outside PATH; yt-dlp output is forced to UTF-8.

## [0.3.2-Alpha] - 2026-10-10

### Fixed

- Jobs started from Home now keep showing their progress after you navigate
  away and back, and the card's button stays disabled while they run.
  Previously leaving the page made the card forget its jobs, so it was easy to
  start duplicates by accident (for example 50 upscales).
- Video Upscaler and Frame Interpolation now return their task immediately, so
  a progress bar appears right away instead of only after the whole job
  finished.

### Added

- Drag & drop: drop files onto the Converter, Image Upscaler, Video Upscaler
  and Interpolation cards, and drag a link onto the Downloader. Dropping a file
  elsewhere in the window no longer replaces the whole UI.
- Library history now persists across launches, with Open folder, Run again
  and Clear finished.
- Per-card presets (Downloader, both Upscalers, Interpolation). The Converter
  gets one-click format presets and "Save as preset" in the format picker.

### Tauri migration: still POSTPONED

Unchanged: the Tauri v2 migration is archived on the `tauri-migration-phase1`
branch but is **postponed and not shipping**. Tauri uses WebKitGTK on Linux,
which stutters/lags and can segfault with hardware compositing on the NVIDIA
proprietary driver under Wayland (an upstream platform bug, not an OPNduck
bug). OPNduck stays on **Electron**.

### Known issues

- Windows installers are built from Linux via wine and are untested on Windows.
- Drag & drop of real files from a file manager was only tested at the code
  path level, not by hand.
- No AUR publication and no artifact signing yet (deferred).

## [0.3.1-Alpha] - 2026-10-10

Hotfix. **Everyone on v0.3.0-Alpha should upgrade.**

### Fixed

- **Critical: installed/packaged v0.3.0-Alpha builds opened a blank,
  transparent window.** `electron/main.cjs` passed a bare filesystem path to
  `win.loadURL()`, which no longer navigates on Electron 44.7 (it worked on
  44.1). The built UI is now loaded with `win.loadFile()`. Dev mode was
  unaffected, which is why it was not caught before release. The packaged
  Linux build was verified to render before this release was published.
- Batch conversions are now capped at 2 running at once.
- Video upscale/interpolate outputs are always `.mp4`.
- Cancelling a LibreOffice conversion now kills the whole process tree (no
  orphaned `soffice.bin`).

### Security / hardening

- Only `http(s)` links are accepted; IPC requests are validated; Spotify
  lookups are restricted to `open.spotify.com`.
- A Content-Security-Policy was added to the renderer.

### Changed

- Full keyboard navigation in dropdowns.
- Command-palette downloads now offer the playlist choice.

### Tauri migration: still POSTPONED

Unchanged from 0.3.0: the Tauri v2 migration is archived on the
`tauri-migration-phase1` branch but is **postponed and not shipping**. Tauri
uses WebKitGTK on Linux, which stutters/lags and can segfault with hardware
compositing on the NVIDIA proprietary driver under Wayland (an upstream
platform bug, not an OPNduck bug). OPNduck stays on **Electron**.

### Known issues

- Windows installers are built from Linux via wine and are untested on Windows.
- No AUR publication and no artifact signing yet (deferred).

## [0.3.0-Alpha] - 2026-10-10

> **Known broken:** installed builds of this version open a blank window.
> Use 0.3.1-Alpha instead.

Largest feature release since 0.2.0: a rebuilt multi-format Converter, YouTube
playlist downloads, AI upscaling/interpolation cards, a lot of UI polish, a
dependency security pass and an audit-hardening pass.

### Tauri migration: POSTPONED

The Tauri v2 migration was fully built (Rust backend, ported pipelines,
vendored Windows sidecars) and is archived on the `tauri-migration-phase1`
branch, but it is **postponed and not shipping**. Tauri uses WebKitGTK on
Linux, which stutters/lags and can segfault with hardware compositing on the
NVIDIA proprietary driver under Wayland (an upstream platform bug, not an
OPNduck bug). OPNduck stays on **Electron** until that is fixed upstream; it
may be revisited for Windows (WebView2) or non-NVIDIA Linux.

### Added

- **Multi-format Converter** (rebuilt): video/audio/image via ffmpeg and
  documents (PDF, DOCX, ODT, RTF, TXT, HTML) via LibreOffice, with a big
  format-picker window, a supported-formats panel and per-tool gating when
  ffmpeg or LibreOffice is missing.
- **YouTube playlist downloading** in the Downloader; Run Task is blocked
  until the link check finishes and the playlist is probed in parallel.
- AI Image Upscaler, AI Video Upscaler (multi-file queue) and AI frame
  interpolation (RIFE) cards, plus rebindable keybinds.
- Hidden "Synced with Omarchy" theme with square corners.
- Real SVG icons instead of emoji/text glyphs.

### Changed

- Motion & Density settings now apply app-wide.
- Home grid lays out with equal-height rows and no gaps.
- Dropdowns are portaled and no longer render underneath neighbouring cards.
- Electron 44.1 to 44.7, React/React DOM 19.3, TypeScript 7.0, framer-motion
  14.1, Vite 8.3, plus minor bumps (react-router-dom, Tabler icons, oxlint,
  wait-on, React types). `@types/node` 26 (Electron 44 bundles Node 24, so
  types are slightly ahead of the runtime).

### Fixed / Security

- yt-dlp option-injection fix (hardened spawning); cancel, preview and picker races.
- Better error messages, ffmpeg stream mapping and theme fallback.
- **Dependency advisories cleared.** `concurrently` 10.0.6 pulls the patched
  `shell-quote` (critical command injection); `npm audit fix` patched
  `brace-expansion`, `http-cache-semantics`, `joi`, `source-map-js`, `undici`
  and `fast-uri`. The only remaining advisory is a dev-only moderate chain
  under `electron-builder` (`sprintf-js` via `roarr`/`global-agent`); the sole
  offered fix downgrades `electron-builder`, so it is left until upstream fixes it.

### Known issues

- Batch conversions start all jobs at once (no concurrency cap).
- Video upscale/interpolate output extension follows the input container.
- Cancelling a LibreOffice job may leave a `soffice.bin` orphan process.
- No URL scheme allow-list or IPC input validation (low exposure; the window is sandboxed).
- No Content-Security-Policy.
- GlassSelect has no keyboard navigation.
- Linux packaging is only built where possible; no Windows/AUR publication in this release.

## [0.2.1-Alpha] - 2026-09-20

Critical packaging bug: the app was effectively unusable once actually
installed (as opposed to run from the dev server) — reported after
installing v0.2.0-Alpha fresh on a Windows machine.

### Fixed

- **Navigation completely broken in the packaged app.** `App.tsx` used
  React Router's `BrowserRouter`, which needs a real HTTP server to resolve
  URL paths. The packaged app loads `index.html` straight off disk via
  `file://` — no server at all — so no route ever matched: no cards
  rendered on any page, and clicking a nav link did nothing. Switched to
  `HashRouter`, which is pure client-side routing and needs no server, so
  it works identically in the Vite dev server, the browser preview, and the
  packaged `file://` app.
- **Social icons missing in the packaged app.** The social-link icons in
  `src/lib/nav.ts` were referenced by hardcoded absolute paths
  (`/icons/x.png`), which resolve against a real server's root in dev but
  resolve to the OS filesystem root under `file://` (e.g. `C:\icons\x.png`
  on Windows) — a 404. Now built from Vite's `BASE_URL`, correct in both
  environments.
- Neither bug was ever visible during development because this project's
  entire test cycle up to this point ran against the Vite dev server
  (`http://localhost:1420`), never the actual packaged build. Added
  renderer console forwarding to the Electron main process
  (`electron/main.cjs`) so a packaged app's JS errors are no longer
  silently invisible with nowhere to look — exactly how this shipped
  unnoticed in the first place.

## [0.2.0-Alpha] - 2026-09-20

First release with a real, working feature: the Downloader now drives an
actual `yt-dlp` process on the system PATH instead of being a UI stub. Per
the project's own versioning rule, this is what moves OPNduck out of
Pre-Alpha.

### Added

- Real media downloading via `yt-dlp` (system PATH, not bundled), wired
  through a new `Host.tasks` interface — the same seam the eventual Tauri
  adapter will implement.
- Full download queue: multiple concurrent downloads, per-item cancel, live
  progress, shown both inline on the Downloader card and on the Downloads
  page.
- Video quality (Best/2160p/1080p/720p/480p/360p) and MP3 bitrate
  (Best/320k/192k/128k) selection, plus an approximate file-size preview
  before starting a download, all via a `yt-dlp --dump-json` probe.
- Video/audio thumbnails on the Downloader card and Downloads queue.
- Format/quality/size metadata shown as small tag chips.
- A default-download-folder setting (Settings > Storage & Performance),
  with a real native folder picker.
- A plain-language install-command banner on the Downloader card when
  `yt-dlp` isn't found on PATH.

### Fixed

- Per-feature card accent glow bled a fixed warm color into the Monochrome
  theme instead of staying neutral.
- Settings category-rail scrollspy jumped to the wrong (next) category when
  clicking a short section like Keybinds.
- Page-slide transition had degraded to a fade-only animation — a shared
  "settled" flag governing a post-animation `transform: none` reset was
  stale on the very first frame of every navigation.
- Top bar could overflow past the window edge and clip content unpredictably
  at ordinary window widths; nav labels now collapse to icon-only below the
  `xl` breakpoint, and the header now has a hard `overflow-hidden` backstop.
- Hamburger menu's dropdown was being clipped by an ancestor's
  `overflow-hidden` — portaled to `document.body` instead, same fix already
  used for the Settings rail.
- Window minimum size could be ignored by the compositor on some
  Linux/Wayland setups (a known Electron limitation for frameless windows);
  now force-clamped in the main process.
- Scrollbars removed entirely, app-wide, instead of chasing further
  per-theme scrollbar-color inconsistencies.

## [0.2.0-Pre-Alpha] - 2026-09-02

First tagged release. Full rewrite of the frontend shell on the new "Liquid
Glass" design system — GUI, routing, theming, settings, and the adaptive
card dashboard. Download/convert/AI engines are not wired in yet (Alpha
phase).

### Changed

- Removed the Flat theme entirely — the theme engine now ships with two
  modes, **Glass** and **Monochrome**, instead of three.
- Removed several AI-generated-UI design clichés identified in an explicit
  design audit: all-caps labels, middle-dot separators, and identical
  nested cards (converted to divider-lists).
- The card hover-lift/glow effect is now toggleable via the existing
  Reduce Motion setting.
- General code simplification and cleanup: removed a shadowed function
  parameter and deduped repeated styling (GlassTune, StorageCard).

### Fixed

- Multi-layered CSS containing-block bug on the Settings page — the
  category rail now correctly follows scroll, implemented via a React
  portal.
- GlassTune dev-tool theme-leak bug where Glass-only colors bled into
  other themes.
- Assorted Settings layout/scroll issues fixed and re-verified during this
  pass (sticky/fixed rail behavior, hamburger dropdown opacity, banner
  placement, page-transition flash).

### Added

- Hover highlight on Settings interactive controls.
- Dev/debug mode (keybind-gated) with a runtime backdrop-tuning panel
  (GlassTune).

### Verification

- `tsc -b` (typecheck), `vite build` (production build), and `oxlint`
  were run clean at each step of this pass, with a final code-audit
  checkpoint commit confirming no regressions.

---

Full commit-level detail: see
[`github-release/opnduck/v0.2.0-Pre-Alpha/CHANGELOG.raw.md`](./github-release/opnduck/v0.2.0-Pre-Alpha/CHANGELOG.raw.md)
for the unabridged git-cliff output.
