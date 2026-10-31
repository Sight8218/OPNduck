# OPNduck v0.5.3-Beta

Free, open source (GPL-3.0), local-first: your media never leaves your machine. Expect bugs and report them on GitHub.

This release adds a terminal version of OPNduck and a first-launch setup wizard. The Tauri migration is still **postponed** (WebKitGTK on Linux stutters/crashes with NVIDIA + Wayland); OPNduck stays on Electron.

### Added
- **OPNduck TUI** (beta): the tools in a terminal, about 100 MB of memory instead of about 680 MB. Tools, Queue, Library, Settings and Setup screens, forms for all eight tools with path completion, live progress, and all 26 themes. It shares settings and history with the desktop app. Unpack `opnduck-tui-0.5.3-beta.tar.gz` (needs Node.js 20 or newer) or run `npm run tui`. Also published as an npm package. See `docs/TUI.md`.
- **Setup wizard**: on first launch (and from Settings, System, Open setup) it lists the downloader, the fast video engine, Audio AI and Subtitles with download sizes, marks what you already have, and installs the ones you tick with live progress and a Cancel button. Tools from your package manager (ffmpeg, Real-ESRGAN, RIFE, LibreOffice) are listed with their install command when missing.

### Changed
- Internal: the job code now lives in Electron-free `electron/core/` modules. The desktop app behaves the same.
- The developer-tool channels in the desktop shell refuse to run unless Developer mode is on. This is a guard inside the app, not a security boundary.
- Switching back to Blarange or Monochrome clears the cached theme colours the startup screen uses.
- Builds no longer include Python `__pycache__` folders.

### Assets
- `OPNduck-0.5.3-beta.AppImage`, `opnduck-desktop-0.5.3-beta.pacman` (Linux x64)
- `OPNduck.Setup.0.5.3-beta.exe`, `OPNduck.0.5.3-beta.exe` (Windows x64 installer and portable)
- `opnduck-tui-0.5.3-beta.tar.gz`
- `SHA256SUMS.txt`

### Known issues
- Windows installers are built from Linux via wine and are still untested on real Windows.
- No AUR publication and no artifact signing yet (deferred).
