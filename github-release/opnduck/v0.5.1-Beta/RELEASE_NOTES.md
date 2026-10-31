# OPNduck v0.5.1-Beta

Free, open source (GPL-3.0), local-first: your media never leaves your machine. Expect bugs and report them on GitHub.

A follow-up to v0.5.0-Beta: OPNduck can now be controlled by any MCP-capable AI app, the menu icons are animated, and something is hiding for the curious. The Tauri migration is still **postponed** (WebKitGTK on Linux stutters/crashes with NVIDIA + Wayland); OPNduck stays on Electron.


### Added
- **A secret for the curious**: something hides behind the OPNduck name. Once found, Settings gains a switch to keep it in the menu.
- **Animated menu icons**: Settings spins, Plugins pulls back and plugs in with a spark, Library pulls a book out, Home hops. They play on hover/press and are off with reduced motion.
- **MCP server** (Settings → System, off by default): any MCP-capable AI app (Claude Code, Codex, Gemini CLI, Cursor, Claude Desktop, LM Studio, ...) can start downloads, conversions, upscales, interpolation, subtitles, trims and audio AI, watch jobs and their logs, cancel jobs and pause the queue. Localhost only, token-protected, saves only to your download folder, jobs are tagged "via MCP". See `docs/MCP.md`.

### Known issues

- Windows installers are built from Linux via wine and are still untested on real Windows.
- No AUR publication and no artifact signing yet (deferred).
