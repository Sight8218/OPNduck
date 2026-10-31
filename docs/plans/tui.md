# Plan: OPNduck TUI (a lightweight, terminal version)

Goal: use OPNduck's tools from a terminal, with no Chromium, no window and no GPU compositing. Idle target: a few tens of MB instead of ~680 MB. Works over SSH. Same tools, same files, same history as the desktop app.

## What the code looks like today

`electron/main.cjs` (~3,960 lines) is one file with the job logic and the Electron glue mixed together. Measured coupling to Electron, all shallow:

| Electron use | Count | Replace with |
|---|---|---|
| `app.getPath('userData' / 'downloads' / ...)` | 16 | `platform.paths.*` |
| `BrowserWindow.getAllWindows().forEach(w => w.webContents.send(...))` (progress, queue state) | ~14 | `platform.emit(channel, payload)` |
| `dialog.showOpenDialog / showSaveDialog` | 5 | not in core; the UI picks files |
| `Notification`, tray, taskbar progress | ~5 | `platform.notify(...)` (TUI: terminal bell, optional `notify-send`) |
| `shell.openPath / showItemInFolder / openExternal` | 5 | `platform.openPath(...)` (TUI: `xdg-open`) |
| `app.isPackaged / getVersion` | 5 | `platform.version`, `platform.resourcesPath` |

The job code itself (`convertJob`, `trimJob`, `videoUpscaleJob`, `chunkedFrameJob`, `torchUpscaleJob`, `audioAiJob`, Whisper, yt-dlp) is plain Node plus child processes. The MCP server (`mcp.cjs`) already takes the task map and start handlers as injected dependencies, so the pattern is proven.

## Design

```
electron/core/            plain Node, no Electron import (new)
  platform.cjs            the interface + a Node default (paths, emit, notify, openPath)
  tools.cjs               find yt-dlp / ffmpeg / realesrgan / rife / python, install hints, engine cache
  tasks.cjs               task map, log buffers, history, queues and pools, cancel, pause
  jobs/download.cjs  convert.cjs  trim.cjs  upscale.cjs  interpolate.cjs  subtitles.cjs  audio_ai.cjs
  settings.cjs            (already almost pure; moves here)
electron/main.cjs         thin: creates the window, hooks IPC channels to core, supplies the Electron `platform`
tui/                      the terminal app (new)
  opnduck-tui.mjs         entry: `opnduck-tui` (also `opnduck tui`)
  screens/                Home (tool list), Download, Convert, Trim, Queue, Library, Settings, Setup
  ui/                     small components: list, checkbox, progress bar, log tail, file picker
```

- **One code path.** The desktop app and the TUI both call `core`. Fixing a job fixes both. Nothing is copied.
- **Move, don't rewrite.** Functions move verbatim into `core/` and only their Electron calls change to `platform.*`. That keeps the risk low.
- **Shared data.** Same `userData` folder (settings, history, engine cache, download defaults). Running the TUI and the app at once is guarded by a lock so history is not written by two processes; the TUI offers to attach to a running app through the existing MCP server instead.
- **Packaging the TUI.** Decision in step 0: a single bundled file run with Node 20+ (small, simple) vs a standalone binary (Node SEA, no Node needed, ~80 MB). Default: bundled file first, binary later.
- **UI library.** Ink (React for terminals) matches the stack, so cards can mirror the desktop layout. Alternative: hand-written ANSI with no dependencies (smallest, more code). Default: Ink, bundled with esbuild so it is one file.

## Screens (v1)

Tool list with the same eight tools; Download (URL, format, quality, live progress); Convert (path or drag a path in, container, remux/transcode); Trim; Queue (running and waiting jobs, pause, cancel, run next, live log tail); Library (history, open folder); Settings (download folder, parallel limits, GPU threads); Setup (tick what to install: yt-dlp, fast engine, Audio AI, Subtitles; uses the same install code as the app). Theme: uses the app's theme palettes mapped to 16/256/truecolor ANSI, accent for the active item, square box-drawing characters.

File picking in a terminal: type or paste a path with tab completion, plus a small directory browser. No native dialogs.

## Steps (each ends with a local commit; the desktop app must work after every step)

0. **Decide and prototype.** DONE: Ink picked; an Ink screen idles at ~91 MB RSS (plain Node 47 MB; the app ~680 MB) and bundles to one 1.7 MB file with esbuild (stub `react-devtools-core`).\n   (original note:) Ink vs hand-rolled, bundle vs binary. Build a 1-screen spike that lists tools and runs one `probe_media` call through the existing MCP server to prove the loop. Throwaway.
1. **Platform seam.** DONE: `electron/core/platform.cjs` (Node implementation) and `electron/platform_electron.cjs`; paths, event broadcast, notifications, open/reveal and version in `main.cjs` now go through `platform`. Dialogs, tray, window and the window-open handler stay in `main.cjs` (UI shell). Add `core/platform.cjs`; route the 16 `getPath`, the window broadcasts, notifications and `shell` calls in `main.cjs` through it. No file moves yet. Verify the app behaves identically (launch, a real download, a real convert).
2. **Move tools and settings.** DONE for tools: `electron/core/tools.cjs` (`createTools(platform)`: detection, hints, Python venv, engine cache, yt-dlp install, pip installs); `main.cjs` keeps only the IPC doors. Settings move next (settings.cjs already has no Electron import, so it only needs the user-data path from `platform`).\n   (original note:) `core/tools.cjs` (detection, hints, engine cache), `core/settings.cjs`. Verify the Settings page, engine checks and the cached-check timings (1 ms cached vs ~2.5 s uncached).
3. **Move the task engine.** `core/tasks.cjs`: tasks, logs, history, pools, cancel, pause. Verify with the MCP bridge end to end (start, status, pause, resume, cancel) and the Library page.
4. **Move jobs one at a time**, each followed by a real run on the desktop app: convert, trim, download, then audio AI, subtitles, interpolate, upscale (image, video ncnn, video torch). Compare output to before (same frame count, duration, audio).
5. **TUI shell and Home/Queue.** Entry point, screen router, theme mapping, Queue screen with live progress. Verify in a real terminal and over a pty at 80x24 and 200x60.
6. **TUI tools.** Download, Convert, Trim screens, then the AI tools. A real job of each kind from the terminal.
7. **Setup, Library, Settings screens**, then packaging (`npm run dist:tui` -> single file; AUR `opnduck-tui` optional).
8. **Docs and hardening.** README and `docs/TUI.md`, CHANGELOG, tests for core modules that no longer need Electron (they can now be unit tested in plain Node), the code-auditor over `core/` and `tui/`, a memory and CPU measurement of the TUI idle vs the app idle for the release notes.

## Risks

- **Regression in the desktop app from the extraction.** Mitigation: move verbatim, one module per commit, real end-to-end run after each, MCP bridge as a headless regression check.
- **The extraction is most of the work (steps 1-4).** The TUI screens (5-7) are comparatively small. Realistic order of magnitude: the extraction is several focused sessions, the TUI about the same again.
- **Two processes, one data folder.** Handled with a lock and an attach mode; to be tested explicitly.
- **Windows terminals.** Ink works in Windows Terminal; the old console host is not a target.
- **Not verified on any machine but this one** until someone tries it elsewhere.

## Not in v1

Sign-in window for YouTube (needs a browser; the TUI can use "cookies from browser" instead), the tray, thumbnails and the visual trimmer (the TUI trim takes start and end times), the arcade, the in-app plugin loader.

## Open decisions (defaults if you don't say)

- Ink (default) vs no-dependency ANSI.
- Ship as a bundled file needing Node 20+ (default) or a standalone binary.
- Command name: `opnduck-tui` (default) or `opnduck tui`.
- Release target: v0.6.0-Beta, after v0.5.2-Beta and the Setup wizard. Not pushed until you say so.
