# OPNduck v0.5.2-Beta

Free, open source (GPL-3.0), local-first: your media never leaves your machine. Expect bugs and report them on GitHub.

A visual and tidying release: Home is a compact grid of tool tiles, there is a themed startup screen, corners are sharper and the wording is plainer. The Tauri migration is still **postponed** (WebKitGTK on Linux stutters/crashes with NVIDIA + Wayland); OPNduck stays on Electron.

### Added
- **New startup screen**: a duck bobbing on moving waves with the wordmark hopping in, all in the colours of your chosen theme (including Omarchy and palette themes).
- **Pixel look**: a blocky pixel wordmark in the top bar and on Home, and a faint scatter of pixels along the top of every page, in the current theme's accent.
- **More developer tools** (Settings, with dev mode on): IPC trace, event-loop lag, saved-settings viewer (redacted), raw job launcher, sample media generator, and layout outlines.

### Changed
- **Home is less crowded**: a compact tile for each tool, and only the tool you pick opens below. The open tool is in the URL (`?tool=`), so the command palette jumps straight to it.
- **Calmer Blarange colours**: neutral surfaces, orange kept for actions, focus and the active item.
- **Sharper corners** (1-4 px).
- **Plainer wording and less filler** across the app.
- **Readable text and icons in every Omarchy palette**, including themes like Nord.

### Performance
- Engine checks (PyTorch, Demucs, Whisper) are remembered between launches and re-checked in the background, so the cards load faster.

### Website
The OPNduck website also got a try-any-theme picker and an omarchy.org-style look (not part of the app).

### Known issues

- Windows installers are built from Linux via wine and are still untested on real Windows.
- No AUR publication and no artifact signing yet (deferred).
