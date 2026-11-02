# Changelog

All notable changes to OPNduck are documented in this file. Generated with
[git-cliff](https://github.com/orhun/git-cliff) from Conventional Commit
history; entries are curated for readability.

## [Unreleased]

### Added
- **Plugin system** (beta): plugins can add a card to Home and/or a background script that starts jobs, reads files, uses the network and adds tools, each behind permissions you approve. New Plugins page (Installed tab) to review permissions, turn plugins on and off, remove them and open the plugins folder, plus a Safe mode switch that skips every plugin. Plugins that are not verified show a warning first. Permissions are not a sandbox; see `PLUGINS.md`. Tools a plugin adds show up for MCP clients (as `<plugin>__<tool>`) and on the TUI home screen, where they open a form and show the result. Plugins are approved in the desktop app; the TUI only runs the ones already approved there. The plugin store tab is a placeholder for now.

## [0.5.3-Beta] - 2026-10-31

### Added
- **OPNduck TUI** (beta): the tools in a terminal, about 100 MB of memory instead of about 680 MB. Tools, Queue, Library, Settings and Setup screens, forms for all eight tools with path completion, live progress, and all 26 themes. It shares settings and history with the desktop app. Run it with `npm run tui`, or unpack the new `opnduck-tui` tarball (needs Node.js 20 or newer). See `docs/TUI.md`. It is also packed as an npm package (`npm run tui:npm`) for the npm registry and GitHub Packages.
- **Setup wizard**: on first launch (and from Settings, System, Open setup) a window lists the downloader, the fast video engine, Audio AI and Subtitles with their download sizes, marks what you already have, and installs the ones you tick one after another with live progress and a Cancel button. Tools that come from your package manager (ffmpeg, Real-ESRGAN, RIFE, LibreOffice) are listed with their install command when missing.

### Changed
- Internal: the job code (downloads, conversion, trimming, upscaling, interpolation, subtitles, AI audio, the task queue and tool detection) now lives in Electron-free `electron/core/` modules, in preparation for a lightweight terminal version. The app behaves the same.
- The developer-tool channels in the desktop shell now refuse to run unless Developer mode is on. This is a guard inside the app, not a security boundary.
- Switching back to Blarange or Monochrome clears the cached theme colours the startup screen uses.

## [0.5.2-Beta] - 2026-10-31

A visual and tidying release. Home is a compact grid of tool tiles, there is a themed startup screen, corners are sharper and the wording is plainer. The Tauri migration is still **postponed** (WebKitGTK on Linux stutters/crashes with NVIDIA + Wayland); OPNduck stays on Electron.

### Added
- **New startup screen**: a duck bobbing on moving waves with the wordmark hopping in, all in the colours of your chosen theme (including Omarchy and palette themes), replacing the old fixed orange gradient bar.
- **Pixel look**: a blocky pixel wordmark in the top bar and on Home, and a faint scatter of pixels along the top of every page, both in the current theme's accent.
- **More developer tools** (Settings, with dev mode on): IPC trace (channel and timing, slow calls highlighted), main-process event-loop lag, saved-settings viewer (redacted), raw job launcher, sample video/audio/image generator, and layout outlines.

### Changed
- **Home is less crowded**: a compact tile for each tool, and only the tool you pick opens below. The open tool is in the URL (`?tool=`), so the command palette now jumps straight to it.
- **Calmer Blarange colours**: neutral warm-black surfaces and borders instead of orange-tinted ones, orange kept for actions, focus and the active item, and a flat wordmark instead of the gradient with a glow. The Beta notice now follows the theme.
- **Sharper corners**: the radius scale is now 1-4 px in Blarange and Monochrome (Omarchy themes were already square).
- **Plainer wording and less filler** across the app: Home is a short "Tools" page, tool cards no longer carry a Desktop/Universal badge, shorter Settings and theme text, a clearer Download button, and the Settings category panel no longer overlaps the page.
- **Readable text and icons in every Omarchy palette**: dim text and the menu icons are now derived from the main text colour (the palettes' own "dark foreground" was almost invisible on themes like Nord), and the pixel logo shades toward the text colour so it also works on light themes.

### Performance
- Engine checks (PyTorch, Demucs, Whisper) are remembered between launches and re-checked in the background, so the cards no longer wait about 2.5 s for a Python start. `nvidia-smi` is asked once per session instead of on every check.

## [0.5.1-Beta] - 2026-10-31

### Added
- **A secret for the curious**: something hides behind the OPNduck name. Once found, Settings gains a switch to keep it in the menu.
- **Animated menu icons**: Settings spins, Plugins pulls back and plugs in with a spark, Library pulls a book out, Home hops. They play on hover/press and are off with reduced motion.
- **MCP server** (Settings → System, off by default): any MCP-capable AI app (Claude Code, Codex, Gemini CLI, Cursor, Claude Desktop, LM Studio, ...) can start downloads, conversions, upscales, interpolation, subtitles, trims and audio AI, watch jobs and their logs, cancel jobs and pause the queue. Localhost only, token-protected, saves only to your download folder, jobs are tagged "via MCP". See `docs/MCP.md`.

## [0.5.0-Beta] - 2026-10-31

The performance release. Video upscaling now streams frames straight through the GPU (PyTorch) with no temporary
image files, AI video jobs encode on the GPU (NVENC), and long videos run in bounded-size chunks. It also adds a
trimmer, a watch folder, queue controls, live logs, all Omarchy 4.5 themes and developer tools. The Tauri migration
is still **postponed** (WebKitGTK on Linux stutters/crashes with NVIDIA + Wayland); OPNduck stays on Electron.

### Added

- **One-click installs:** missing Python tools can be installed from the card itself. AI Audio sets up
  Demucs and Subtitles sets up faster-whisper inside OPNduck's own Python environment (progress shown,
  cancelable). The manual command stays visible.
- **yt-dlp** can be downloaded and updated from inside OPNduck (checksum-verified, no admin rights);
  Settings → Downloads shows the version and an Update button.
- **Spotify tracks:** pasting a link switches the format to MP3, and "Run again" on a failed match
  asks, then picks a different YouTube video (premieres are skipped).
- New app icon (the website duck).
- `packaging/aur/PKGBUILD` for an Arch package that runs on the system `electron`.
- A "How many" limit for channel and search links in the command-palette download panel, and a notice
  when some files of a batch couldn't be started.

- **Watch folder:** Settings → Watch folder converts new media files dropped into a chosen folder (checked every 10
  seconds; files still being copied are left alone; results go to a `converted` subfolder; each file is handled once).
- **Trim card:** cut a section out of a video or audio file. *Fast cut* copies the streams (instant, snaps to the
  nearest keyframe); *Precise* re-encodes for an exact frame.
  **Open visual trimmer…** shows a pop-up with a thumbnail timeline, two draggable handles (or ← → keys) and a live
  preview of the frame at the handle you are moving.
- **Queue controls:** *Pause queue* in the Library stops waiting jobs from starting (running ones finish), *Run next*
  moves a queued job to the front of its line, and Settings → Job queue sets how many downloads (1–6) and
  conversions (1–4) run at once.
- **All Omarchy 4.5 themes built in:** Settings → Appearance now lists every theme from Omarchy 4.5.0-rc2 (23, including
  the new **Jade Horse** and **Starship**), plus **Osaka Jade**, which rc2 dropped but stays here as a swatch picker. They work on any system, not just where Omarchy is
  installed, share the Omarchy look and keep your choice between launches. "Synced with Omarchy" still follows your live
  theme and picks up new Omarchy themes automatically.
- **Dev launcher (`npm run desktop:dev`):** only one dev session at a time. Starting it again stops the previous one
  (Vite and Electron) instead of piling up windows, frontend edits hot-reload, backend edits (`electron/*.cjs`, `.py`)
  restart the app automatically, and closing the app stops everything it started. Normal launches are also
  single-instance now: opening OPNduck again just brings the open window forward.
- **Developer tools additions:** a performance overlay (FPS, JS heap, DOM nodes), a theme token viewer with color
  chips and Copy as CSS, a local-storage editor, and window-size presets.
- **More developer utilities** (Settings → Developer tools, with dev mode on, Ctrl+Shift+D): system and tool versions
  (OPNduck, Electron, Chromium, GPU, yt-dlp, ffmpeg, upscalers, Python, PyTorch), live per-process CPU and memory, an
  app log viewer with level filters, a raw tasks inspector, buttons for DevTools, reload, the data folder and a test
  notification, simulated jobs (success or failure) to try the UI, and **Copy diagnostics** — a bug-report text with
  your home folder and any credentials removed.
- **Notifications and tray:** Settings → Notifications & tray. A desktop notification when jobs finish while OPNduck
  isn't the focused window (a batch becomes one notification), and an option to keep running in the system tray
  when you close the window so jobs and subscription checks continue.
- **Download extras:** a checkbox embeds cover art and tags (title, artist) into MP3, MP4 and MKV files (FLAC gets
  tags only). Subtitles can be **translated to English** (new checkbox on the Subtitles card; output `name.en.srt`).

### Fixed

- **Progress bars no longer jump backwards.** A download's video and audio streams each restarted the bar from
  0%; progress is now weighted by stream size, never moves backwards while a job runs, and every bar eases
  toward the reported value instead of snapping.
- **Frame Interpolation** failed with "only rife-v4 model support custom numframe" on installs whose RIFE
  defaults to an older model; it now uses `rife-v4.6`.
- Subtitles failed with "unexpected keyword argument 'metadata_errors'" when the system PyAV didn't
  match faster-whisper; audio is now decoded with ffmpeg. Songs no longer come out empty (the speech
  filter is retried off), and a file with no speech reports that instead of saving an empty .srt.

### Changed
- Readable text and icons in every Omarchy palette: dim text and the menu icons are now derived from the main text colour (the palettes' own "dark foreground" was almost invisible on themes like Nord), and the pixel logo shades toward the text colour so it also works on light themes.
- Pixel look: a blocky pixel wordmark in the top bar and on Home, and a faint scatter of pixels along the top of every page, both in the current theme's accent.
- Sharper corners: the radius scale is now 1-4 px in Blarange and Monochrome (Omarchy themes were already square).
- Calmer Blarange colours: neutral warm-black surfaces and borders instead of orange-tinted ones, orange kept for actions, focus and the active item, and a flat wordmark instead of the gradient with a glow. The Beta notice now follows the theme.
- Plainer wording and less filler across the app: Home is a short "Tools" page, tool cards no longer carry a Desktop/Universal badge, shorter Settings and theme text, a clearer Download button, and the Settings category panel no longer overlaps the page.


- **Electron 45.2.0** (Chromium 156, Node 24.22). Release notes for 45.0–45.2 reviewed: nothing in OPNduck uses the
  removed sandbox preload globals, the changed ASAR `fs.open` behaviour, or the deprecated `safeStorage`. New in
  OPNduck from it: the taskbar/dock icon shows the overall progress of running jobs (`setProgressBar`, now working on
  Linux launchers too), the "job finished" notification has a **Show in folder** button, and the window remembers its
  position, size and maximized state between launches (not visible on tiling window managers, which set the size).

### Security

- Updated Electron to 44.10.0 and refreshed dependencies; `npm audit` now reports 0 vulnerabilities (Electron, undici
  and fast-uri advisories).

### Performance

- **Faster video upscaling engine (PyTorch, NVIDIA):** frames now stream ffmpeg → GPU → ffmpeg through pipes with
  no temporary image files at all. End to end on an RTX 3080 it was about 1.4–1.8× faster than the classic engine
  at 2× and 2.3–3.6× faster at 4× (output quality matches: SSIM 0.993). Settings → GPU jobs picks Auto or Classic
  (ncnn); the Video Upscaler card offers a one-click install (about 5 GB) when it isn't set up. Model weights are
  official Real-ESRGAN releases downloaded once, checksum-pinned. Any failure falls back to the classic engine
  automatically, and cancelling removes the partial file.
- **GPU video encoding (NVENC):** AI video jobs encode on the GPU when it works (H.264 up to 4096 px wide, HEVC
  above), falling back to x264 on any failure. Settings → GPU jobs can force the CPU.
- **Show live logs:** every task card (and each Library row) has a "Show live logs" toggle that tails what the
  job's tools are printing right now (yt-dlp, ffmpeg, the upscalers, Whisper, Demucs) plus the pipeline's own
  steps (e.g. "Chunk 2 of 5: upscaling"). Logs live in memory only.
- **GPU subtitles (NVIDIA):** the Subtitles card offers a one-click "Add GPU support" (about 2.3 GB: the CUDA 12
  runtime libraries Whisper's GPU engine needs, installed into OPNduck's own Python environment, nothing
  system-wide). In testing a 20-second clip with the `small` model took 5 s instead of about 45 s on the CPU. If
  the GPU can't be used, subtitles still fall back to the CPU automatically.
- **AI models stay loaded between files:** AI Audio (Demucs) and Subtitles (Whisper) now run in a background
  worker that keeps the model in memory, so a batch only pays the load cost once (second Demucs job: 4.3 s →
  0.9 s on a 20-second clip). The worker exits after 60 s idle so it doesn't hold GPU memory, and cancelling a
  job simply restarts it.
- **Long videos no longer need huge temp space:** video upscaling and frame interpolation now work in
  chunks (the video is split without re-encoding, each chunk is processed and encoded on its own, then the
  chunks are joined with the original audio). Temp disk use is bounded by one chunk (about 2.5 GB) instead of
  every frame of the video; a 12-second test clip dropped from 226 MB to 59 MB (upscale) and 74 MB to 21 MB
  (interpolate) with identical frame counts and duration. Each chunk reloads the model, so very short clips
  can take a little longer.
- **Smaller install:** the app archive no longer carries 105 MB of UI libraries that were already bundled
  into the page (50 MB → 1.4 MB), and only the English Chromium locale ships. Unpacked app 332 → 276 MB,
  AppImage 136 → 124 MB. Library, Settings and Plugins load when first opened (main script 549 → 492 KB).
- **Faster AI video jobs:** the upscaler and frame interpolator now load, process and save frames in
  parallel (measured on an RTX 3080: video upscale ~27% and interpolation ~20% faster end to end on a
  small clip; up to 2× on the GPU step alone). Settings → GPU job speed has a *Low memory* mode for older
  GPUs, and a job that fails right away on the fast setting retries once on the conservative one.
- The Library no longer re-sends and re-renders hundreds of finished rows on every progress tick, and
  long histories load 60 at a time. Stale temp folders from interrupted jobs are cleaned at startup.

### Known issues

- Windows installers are built from Linux via wine and are still untested on real Windows.
- The PyTorch upscaling engine, NVENC and GPU subtitles need an NVIDIA GPU; other GPUs use the classic engine.
- No AUR publication and no artifact signing yet (deferred).

## [0.4.0-Beta] - 2026-10-18

First Beta. The Tauri migration is still **postponed** (WebKitGTK on Linux stutters/crashes with
NVIDIA + Wayland); OPNduck stays on Electron.

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

- **Downloader power-ups:** 8K (4320p) and 1440p quality; subtitles (uploaded or auto-generated, any
  language the video offers, saved as .srt, optionally embedded, or subtitles-only); dubbed/multi-language
  audio tracks saved as separate MP3 files; 360°/3D tags; whole channels, search results, Watch Later and
  Liked lists with a "first N" choice; a proxy setting (Settings → Downloads); and **Smart mode**, which
  remembers your choices for every new download (card and command palette).

- **Sign-in for private content** (Settings → Downloads): use your browser's login (Firefox, Chromium,
  Chrome, Edge, Brave, Opera, Vivaldi, with an optional profile), a `cookies.txt` file, or OPNduck's own
  sign-in window (separate session; only cookies are saved, in a private file, deleted by Sign out).
  Unlocks Watch Later, Liked videos, private playlists and age-restricted media. Includes a Test sign-in
  button.

- **Library management:** search, filter by type and status, and sort (newest, oldest, name, size,
  status); batches (several files started together, or a download plus its audio tracks) show as one
  collapsible group with Cancel all and Retry failed; remove single entries; **Export** the history to a
  JSON file and **Import** it back (add to history, or add and run again) — imports are re-validated,
  so a hand-edited file can't smuggle in anything the app wouldn't accept. History now keeps 500 entries.

- **Subscriptions** (Library → Subscriptions, or "Subscribe to new uploads" on a channel/playlist link in
  the Downloader): new uploads download automatically. Checked shortly after launch and then hourly
  while OPNduck is open; only future uploads by default (optionally the latest 3/5/10 too); a failed
  download is retried on the next check (up to 3 times per session); desktop notification when something new starts.

- **AI Audio card** (Demucs): remove vocals (instrumental), extract vocals / remove background music,
  isolate a voice (vocals + speech cleanup), and a basic ffmpeg echo & noise reduction mode. Works on
  audio or video files (optionally putting the processed audio back on the video), outputs MP3/FLAC/WAV.
  Needs Python with `torch`, `demucs` and `soundfile` (a venv at `~/.opnduck-venv` is found automatically, or set `OPNDUCK_PYTHON`); the card
  shows the install command when it's missing.

### Changed
- Readable text and icons in every Omarchy palette: dim text and the menu icons are now derived from the main text colour (the palettes' own "dark foreground" was almost invisible on themes like Nord), and the pixel logo shades toward the text colour so it also works on light themes.
- Pixel look: a blocky pixel wordmark in the top bar and on Home, and a faint scatter of pixels along the top of every page, both in the current theme's accent.
- Sharper corners: the radius scale is now 1-4 px in Blarange and Monochrome (Omarchy themes were already square).
- Calmer Blarange colours: neutral warm-black surfaces and borders instead of orange-tinted ones, orange kept for actions, focus and the active item, and a flat wordmark instead of the gradient with a glow. The Beta notice now follows the theme.
- Plainer wording and less filler across the app: Home is a short "Tools" page, tool cards no longer carry a Desktop/Universal badge, shorter Settings and theme text, a clearer Download button, and the Settings category panel no longer overlaps the page.


- Job queues: downloads run 3 at a time, conversions 2, GPU jobs (upscale, interpolation, AI audio) 1;
  the rest wait in line.
- Output files never overwrite each other: names are reserved when a job is queued, so batch items
  with the same file name get a numbered suffix.
- Many hardening fixes from the pre-beta audits: stricter validation of imports, settings and
  sign-in windows, safer folder opening, subscription retry limits, and MP4-safe video output for
  AI Audio.
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

### Known issues

- Windows installers are built from Linux via wine and are still untested on real Windows.
- AI Audio: real-music separation quality has only been checked on speech. The Demucs install is
  large (about 5.5 GB including the CUDA libraries).
- Signing in inside the built-in window may be refused by Google; use browser cookies instead.
- A Library with a very large history is not virtualized; task updates still include history;
  stale temp folders are not swept at startup; the Smart download panel has no "first N" limit
  for channels.
- No AUR publication and no artifact signing yet (deferred).

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
- Readable text and icons in every Omarchy palette: dim text and the menu icons are now derived from the main text colour (the palettes' own "dark foreground" was almost invisible on themes like Nord), and the pixel logo shades toward the text colour so it also works on light themes.
- Pixel look: a blocky pixel wordmark in the top bar and on Home, and a faint scatter of pixels along the top of every page, both in the current theme's accent.
- Sharper corners: the radius scale is now 1-4 px in Blarange and Monochrome (Omarchy themes were already square).
- Calmer Blarange colours: neutral warm-black surfaces and borders instead of orange-tinted ones, orange kept for actions, focus and the active item, and a flat wordmark instead of the gradient with a glow. The Beta notice now follows the theme.
- Plainer wording and less filler across the app: Home is a short "Tools" page, tool cards no longer carry a Desktop/Universal badge, shorter Settings and theme text, a clearer Download button, and the Settings category panel no longer overlaps the page.


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
- Readable text and icons in every Omarchy palette: dim text and the menu icons are now derived from the main text colour (the palettes' own "dark foreground" was almost invisible on themes like Nord), and the pixel logo shades toward the text colour so it also works on light themes.
- Pixel look: a blocky pixel wordmark in the top bar and on Home, and a faint scatter of pixels along the top of every page, both in the current theme's accent.
- Sharper corners: the radius scale is now 1-4 px in Blarange and Monochrome (Omarchy themes were already square).
- Calmer Blarange colours: neutral warm-black surfaces and borders instead of orange-tinted ones, orange kept for actions, focus and the active item, and a flat wordmark instead of the gradient with a glow. The Beta notice now follows the theme.
- Plainer wording and less filler across the app: Home is a short "Tools" page, tool cards no longer carry a Desktop/Universal badge, shorter Settings and theme text, a clearer Download button, and the Settings category panel no longer overlaps the page.


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
- Readable text and icons in every Omarchy palette: dim text and the menu icons are now derived from the main text colour (the palettes' own "dark foreground" was almost invisible on themes like Nord), and the pixel logo shades toward the text colour so it also works on light themes.
- Pixel look: a blocky pixel wordmark in the top bar and on Home, and a faint scatter of pixels along the top of every page, both in the current theme's accent.
- Sharper corners: the radius scale is now 1-4 px in Blarange and Monochrome (Omarchy themes were already square).
- Calmer Blarange colours: neutral warm-black surfaces and borders instead of orange-tinted ones, orange kept for actions, focus and the active item, and a flat wordmark instead of the gradient with a glow. The Beta notice now follows the theme.
- Plainer wording and less filler across the app: Home is a short "Tools" page, tool cards no longer carry a Desktop/Universal badge, shorter Settings and theme text, a clearer Download button, and the Settings category panel no longer overlaps the page.


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
