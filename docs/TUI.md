# OPNduck TUI

The OPNduck tools in a terminal: download, convert, trim, upscale (image and video), frame interpolation, subtitles and AI audio. It runs the same job code as the desktop app (`electron/core/`), shares its settings and history, and needs no window: about 100 MB of memory instead of about 680 MB, and it works over SSH.

## Run it

From a checkout: `npm run tui` (builds and starts it).
From a release: unpack `opnduck-tui-<version>.tar.gz` and run `./opnduck-tui.mjs` (needs Node.js 20 or newer).

Options: `--theme <name>` (any of the 26 themes, also `OPNDUCK_THEME`), `--screen <tools|queue>`, `--start <channel> '<json>'` to start a job when it opens (repeatable), `--help`.

## Screens

| Key | Screen | What it does |
|---|---|---|
| 1 | Tools | The eight tools. Enter opens a tool's form. |
| 2 | Queue | Running and waiting jobs with live progress. `p` pause/resume, `c` cancel, `n` run next, `r` again, `d` remove, `x` clear finished, `l` log, `o` open the folder. |
| 3 | Library | Everything that finished, with the output path. `o`, `r`, `d`, `x`. |
| 4 | Settings | Colours, notifications, GPU performance, video engine and encoder, parallel jobs, proxy. Saved at once, shared with the desktop app. |
| 5 | Setup | Choose what to install (yt-dlp, the PyTorch engine, Audio AI, Subtitles) and see what your package manager still has to provide. |

Tool forms: `↑↓` move, `←→` change a choice, `Tab` completes a path, `Enter` goes to the next field and starts the job on **Start**, `Esc` goes back. Times accept seconds or `m:ss`. While you type in a field the global keys (`q`, `1`-`5`, `Tab`) are off.

`q` quits; with jobs running it asks first, then cancels them.

## Not in the TUI

The YouTube sign-in window (use the desktop app, or set a cookies file or browser in the desktop Settings; the TUI uses the same setting), the tray, thumbnails, the visual trimmer, library export and import, and the downloader's playlist/subtitle options. Each form takes one file or link.

## How it is built

`electron/core/` has the job code with no Electron import; `core/platform.cjs` is the small interface to the operating system (paths, events, notifications, opening folders). `tui/` is the Ink (React for terminals) app. `scripts/build-tui.mjs` bundles both into `dist-tui/opnduck-tui.mjs` plus the Python helper scripts; `scripts/pack-tui.mjs` makes the tarball. The tool forms are generated from the job definitions in `electron/mcp_tools.cjs`, the same ones the MCP server uses.
