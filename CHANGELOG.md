# Changelog

All notable changes to OPNduck are documented in this file. Generated with
[git-cliff](https://github.com/orhun/git-cliff) from Conventional Commit
history; entries are curated for readability.

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
