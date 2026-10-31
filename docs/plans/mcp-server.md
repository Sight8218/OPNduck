# Plan: OPNduck as an MCP server

Goal: let Claude Code (or any MCP client) start and watch OPNduck jobs. Off by default.

## Design

```
MCP client --stdio--> electron/mcp_bridge.cjs (tiny, no Electron) --localhost TCP + token--> running OPNduck main process
```

- **Why a bridge:** MCP clients launch a stdio command. The bridge is a plain Node script, so it starts without the app UI. It just forwards JSON requests to the running app.
- **In the app (`electron/mcp.cjs`, new):** a `127.0.0.1`-only server on a random port. It requires a bearer token and rejects requests with an `Origin` header (blocks web pages from calling it). Port and token are written to `userData/mcp.json` with file mode 0600. The server runs only while the setting is on.
- **Reuse, don't duplicate:** `startHandlers` (already in `main.cjs`) holds the wrapped start handlers, so MCP jobs go through the same validation, queue, history and notifications as UI jobs. No second code path.
- **Dependency:** `@modelcontextprotocol/sdk` in the bridge only, or a ~150-line hand-written JSON-RPC stdio loop if the SDK is too heavy for the package. Decide in step 1 by measuring.

## Tools exposed (v1)

| Tool | Does | Notes |
|---|---|---|
| `download` | start yt-dlp job (url, format, quality, destination) | URLs validated by existing `validateDownloadRequest` |
| `convert` | ffmpeg convert (path, format) | |
| `upscale_image`, `upscale_video`, `interpolate` | ncnn/torch jobs | |
| `subtitles` | whisper (path, model, language, format) | |
| `trim` | cut a range (path, start, end) | |
| `list_jobs` | id, kind, status, progress, label, error | |
| `job_status` | one job plus last N log lines | reuses `tasks:logs` |
| `cancel_job` | cancel by id | |
| `queue_pause` / `queue_resume` | global queue control | |
| `probe_media` | duration, streams, size | read-only |

Not in v1: deleting files or history, changing settings, opening folders, reading arbitrary files, dev tools.

## Security rules (the important part)

1. Off by default; a Settings → "MCP server" toggle with a visible "running on port N" and a "Reset token" button.
2. Localhost bind plus token; compare with `crypto.timingSafeEqual`; no `Origin` header allowed.
3. **File access:** input paths must exist and be regular files; output goes to the normal download dir or a `destination` the user already uses. No writing to arbitrary paths from MCP (restrict `destination` to the configured download dir unless the setting "allow MCP to choose folders" is on).
4. Every MCP-started job is labelled "via MCP" in the Library so it is visible.
5. Rate limit: max 20 running+queued MCP jobs.
6. The bridge never logs the token; `redact()` covers MCP logs.
7. Treat tool arguments as untrusted: validate with the same checks as IPC (types, lengths, enums).

## Steps (each ends with a local commit)

1. **Server core:** `electron/mcp.cjs` with auth, `userData/mcp.json`, JSON `{method, params}` dispatch, `list_jobs` and `job_status` only. Settings key `mcpServer: boolean` in `settings.cjs`. Test with `curl` (good token, bad token, wrong origin).
2. **Bridge:** `electron/mcp_bridge.cjs` stdio MCP server forwarding to the app. Test with `npx @modelcontextprotocol/inspector` and with `claude mcp add`.
3. **Start tools:** wire `download`, `convert`, `trim`, `subtitles`, then the upscale/interpolate ones via `startHandlers`, tagging jobs "via MCP". Test each with a real small job and check it appears in the Library with progress.
4. **Control tools:** `cancel_job`, queue pause/resume, `probe_media`.
5. **Settings UI:** `McpCard.tsx` in Settings (toggle, status, copy "claude mcp add" command, reset token). Host adapter methods in `src/host/` (`mcp.get/set/resetToken`), browser stub no-op.
6. **Docs + hardening:** README/CHANGELOG section, `docs/MCP.md` with the tool list and security notes, tests for the auth and path-validation rules. Run the code-auditor over the new files.
7. **Verify end to end:** launch the dev app, enable the toggle, add the MCP server to Claude Code, ask it to download and convert a small file, watch the job in the Library; confirm that with the toggle off the port is closed.

## Open decisions (defaults if you don't say)

- Packaging: bridge ships inside the app, and the command shown in Settings points to it (default).
- Windows: named pipe not needed; localhost TCP works the same (default).
- Include `queue_pause`/`resume` in v1: yes.
- Release target: v0.6.0-Beta, not pushed until you say so.
