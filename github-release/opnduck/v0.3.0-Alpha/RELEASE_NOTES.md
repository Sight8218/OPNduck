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

## Checksums (SHA256)

```
0817a03b7186545dcf45fad9c89ea2ef94666914fa0fb0b4a7e4c11cad41aa2d  OPNduck-0.3.0-alpha.AppImage
02e9e2a8860df2e5699ae3ba7aab0c93906a31b9646dfd014499b9b6f4e3aafd  OPNduck.0.3.0-alpha.exe
df4a74b266649ab265af6fc32e8d97bd91981faba8ceb1ca54c7953ff3c027f1  opnduck-desktop-0.3.0-alpha.pacman
bec47b7242114286575ddf6d8e2e1a05cf2ddfe3e7a38431d9a290c96ae1a38a  OPNduck.Setup.0.3.0-alpha.exe
```
