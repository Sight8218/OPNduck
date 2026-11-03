# OPNduck as an MCP server

OPNduck can be driven by any AI app that supports the [Model Context Protocol](https://modelcontextprotocol.io): Claude Code, Codex CLI, Gemini CLI, Cursor, Claude Desktop, LM Studio and others. It is off by default.

## Turn it on

1. Settings → Connections → **MCP server** → turn it on.
2. Pick your AI app in the same card. OPNduck shows the exact command to run, or the JSON to paste into that app's MCP settings.
3. Keep OPNduck running while you use the tools.

Any client that can start a stdio MCP server works. Clients that only accept a web URL (no command) are not supported yet.

## Tools

| Tool | What it does |
|---|---|
| `download` | yt-dlp download from a URL (format, quality) |
| `convert` | convert a media, image or document file |
| `upscale_image`, `upscale_video` | Real-ESRGAN |
| `interpolate` | RIFE frame interpolation (2x/4x) |
| `subtitles` | Whisper subtitles (SRT/VTT, optional translate to English) |
| `trim` | cut a section out of a file |
| `list_recipes`, `run_recipe` | list saved recipes (chains of tools) and run one on a file or link; the steps appear as one group |
| `suggest_settings` | look at a file and suggest settings for a tool (model, scale, remux or re-encode...), with the reason for each; starts nothing |
| `remove_background` | cut a person or object out of a picture or video with no green screen; transparent, a colour, a blur or another picture behind it (needs the Background Remover add-on) |
| `dub_video` | make a video speak another language with a local voice (English, Swedish, German, French, Spanish or Italian); the picture is not re-encoded and the voice is not cloned (needs the Dubbing add-on) |
| `grade` | colour grade a video: automatic fixes, a look (six built in, your own .cube files, or matched to a picture) and sliders; HDR is tone-mapped to SDR first |
| `beat_analyze` | find the tempo (BPM), beats and key of a song; optionally write them as tags (needs the Beat Finder install) |
| `beat_cut` | make a montage that switches clips on the beat of a song |
| `restore` | clean up old footage: deinterlace, denoise, stabilize, fix colors, then optionally upscale and smooth the motion as follow-up jobs |
| `jump_cut` | remove the silences from a talking video or podcast and/or even out the loudness (podcast -14 LUFS, broadcast -23 LUFS) |
| `make_gif` | clip a section to GIF, animated WebP, or a Telegram/Discord sticker (fitted to the size limits) |
| `tag_music` | look a song up by its audio fingerprint and write tags and cover art, only when sure enough (needs Chromaprint) |
| `compress` | make a file land under a size in MB (Discord, email), two-pass x264 or GPU |
| `audio_ai` | vocal removal / voice isolation / cleanup |
| `list_jobs`, `job_status` | progress, output path, last log lines |
| `cancel_job`, `queue_pause`, `queue_resume` | control |
| `probe_media` | duration, resolution (read-only) |

Start tools return a job id right away; poll `job_status` for the result.

## Plugin tools

Tools added by plugins (see `PLUGINS.md`) are listed too, named `<plugin id>__<tool>`, while the plugin is on and approved for the `tools` permission. They run inside the plugin with only the permissions you approved. Unlike the built-in tools they are not limited to jobs: a plugin tool does whatever that plugin's code does within its permissions, so only turn on plugins you trust.

## Safety

- Listens on `127.0.0.1` only, on a random port, and needs a private token (`mcp.json` in the app's data folder, owner-only).
- Browser requests (anything with an `Origin` header) are refused.
- Tools only accept existing regular files by absolute path, and never choose an output folder: everything saves to your normal download folder.
- No tool deletes files, changes settings or reads arbitrary files.
- At most 20 MCP jobs may be waiting or running; they show a "via MCP" tag in the Library.
- Turning the setting off closes the port and deletes the token. "Reset token" issues a new one.

## How it works

`electron/mcp_bridge.cjs` is a small stdio MCP server (plain Node, no dependencies) that the AI app starts. It forwards each call to the running app (`electron/mcp.cjs`), which runs the same job handlers the UI uses. Tool definitions live in `electron/mcp_tools.cjs`.
