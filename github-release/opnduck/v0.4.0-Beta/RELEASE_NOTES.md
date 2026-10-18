# OPNduck v0.4.0-Beta

First Beta. Free, open source (GPL-3.0), local-first: your media never leaves your machine. Expect bugs and report them on GitHub.

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

## Downloads

- Linux: `OPNduck-0.4.0-beta.AppImage`, `opnduck-desktop-0.4.0-beta.pacman`
- Windows (untested on real Windows): `OPNduck.Setup.0.4.0-beta.exe` (installer), `OPNduck.0.4.0-beta.exe` (portable)

## Checksums (SHA256)

```
8777d1a84614df6d5387e465a74950866006d26ff855957e496771f60bc91ac8  OPNduck-0.4.0-beta.AppImage
828361c6230849600f04d96eb036c942c267c4956d771a1d1e86fe0a4e3de08b  OPNduck.0.4.0-beta.exe
a09b47334ee452f38bbb3cc2d672b1ac358ea09a6400c5d9edbcbc6fc62786aa  opnduck-desktop-0.4.0-beta.pacman
478701d559872d2ddc351330a4e4f3b2abca02c167f310b112a9807fc7c70974  OPNduck.Setup.0.4.0-beta.exe
```
