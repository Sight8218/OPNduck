# Writing an OPNduck plugin

A plugin is a folder with a `plugin.json` manifest and up to two scripts:

- a **UI entry**: a React card that shows up on the Home grid (desktop app only), and/or
- a **backend entry**: a Node script that runs in its own worker, can start jobs, read files,
  call the network and register tools. It loads in the desktop app, the terminal app (TUI)
  and the MCP server.

Either part is optional. A plugin with only a `backend` and `tools` is a "headless" plugin: no
card, but its tools show up for MCP clients and in the TUI.

> **Status: spec v2 (apiVersion 1), beta.** Backends, tools, cards, the Plugins page and the store all work. Manifests from the old v1 format (single `entry`, no permissions) still load, as a UI-only plugin with no permissions.

## Where plugins live

Installed plugins live in `<userData>/plugins/<plugin-id>/`:

- Linux: `~/.config/opnduck-desktop/plugins/<id>/`
- macOS: `~/Library/Application Support/opnduck-desktop/plugins/<id>/`
- Windows: `%APPDATA%\opnduck-desktop\plugins\<id>\`

Which plugins are enabled, and which permissions you granted each, is stored next to them in
`plugins.json`. Dropping a folder in by hand works; it is treated as **unverified**.

## Trust: Verified and Unverified

A plugin runs code on your computer. OPNduck splits plugins into two groups:

- **Verified**: listed in the official plugin index with a pinned commit and checksum, after the
  OPNduck maintainer reviewed it. One-click install; you still see its permissions.
- **Unverified**: everything else (community store entries, drop-in folders, GitHub URLs).
  Before install you get a warning: *this plugin is not verified, OPNduck takes no responsibility
  for what it does, inspect its code on GitHub first*, plus the permission list, and you must
  confirm.

**Permissions limit what a well-behaved plugin can ask the host API to do. They are not a sandbox.**
A backend script is Node code running with your user's privileges, so an unverified plugin should
be treated like any program you downloaded. Read the code first.

## `plugin.json`

```json
{
  "id": "convert-helper",
  "name": "Convert Helper",
  "version": "0.1.0",
  "apiVersion": 1,
  "author": "Your Name",
  "description": "One or two sentences shown on the card and in the store.",
  "tagline": "Short subtitle under the title",
  "icon": "★",
  "accent": "rgba(120, 190, 255, 0.45)",
  "scope": "universal",
  "repo": "https://github.com/you/opnduck-convert-helper",
  "permissions": ["jobs", "files:read", "settings", "notify"],
  "ui": { "entry": "ui.js" },
  "backend": { "entry": "backend.cjs" },
  "tools": [],
  "commands": [{ "id": "convert-helper.run", "title": "Convert Helper: run on a file" }],
  "settings": {
    "preset": { "type": "string", "enum": ["small", "fast"], "default": "small", "title": "Preset" }
  }
}
```

| Field         | Required | Notes |
|---------------|----------|-------|
| `id`          | yes      | Unique, kebab-case, `a-z0-9-`, max 40 chars. Also the folder name. Must not reuse a core id (`downloader`, `converter`, `image-upscaler`, `video-upscaler`, `frame-interpolation`, `subtitles`, `audio-ai`, `trim`). |
| `name`        | yes      | Display title. |
| `version`     | yes      | SemVer. |
| `apiVersion`  | v2       | Plugin API version this was written for. Currently `1`. Missing = a v1 manifest. |
| `author`      | yes      | Credited name. |
| `description` | yes      | Shown on the card and in the store. |
| `tagline`     | UI only  | Under the title, e.g. `"MP4 · MKV · WebM"`. |
| `icon`        | UI only  | One glyph, no emoji, in the style of the built-in cards (`⇩`, `⇄`, `⇧`). |
| `accent`      | no       | CSS color for the hover glow. Ignored in Monochrome by design. |
| `scope`      | UI only  | `"universal"` or `"desktop-exclusive"`, controls the badge. |
| `repo`        | no*      | Source repository URL. *Required for store listing, so users can inspect the code.* |
| `permissions` | no       | Array of names from the table below. Default `[]`: the plugin can render and nothing else. |
| `network`     | with `network` perm | Array of exact hostnames the plugin may contact, e.g. `["api.github.com"]`. |
| `ui`          | no       | `{ "entry": "ui.js", "slot": "selector" | "stage" }`: `entry` is a path relative to the plugin folder (v1's top-level `entry` is read as `ui.entry`). `slot` is optional, see [Slot plugins](#slot-plugins-selector-and-stage). |
| `backend`     | no       | `{ "entry": "backend.cjs" }`: CommonJS file, path relative to the plugin folder. |
| `tools`       | no       | MCP/TUI tool definitions, see [Tools](#tools). Needs the `tools` permission. |
| `commands`    | no       | Entries for the command palette: `{ "id", "title" }`. Handled by `opnduck.commands.handle(id, fn)`. |
| `settings`    | no       | Schema for the plugin's own settings: `{ key: { type: "string"|"number"|"boolean", title, default, enum? } }`. |

Entry paths may not leave the plugin folder (no `..`, no absolute paths, no symlinks out). A
manifest that fails validation is listed as broken and never loaded.

## Permissions

Declared in `permissions`, shown to the user before install, and enforced by the host API on
every call. A call without the permission rejects with `PermissionError`.

| Permission    | Lets the plugin |
|---------------|-----------------|
| `jobs`        | Start jobs through the task engine (`download`, `convert`, ...), list and cancel its own jobs. |
| `files:read`  | Read files the user picked for it, and the download folder. |
| `files:write` | Write files into the download folder or a folder the user picked. |
| `network`     | `opnduck.net.fetch` to the hostnames listed in `network`. Nothing else. |
| `exec`        | Run the binaries OPNduck already manages (`ffmpeg`, `yt-dlp`, ...) by name, with any arguments. **Treat this as close to `exec:any`**: those programs can read and write any file (`ffmpeg -i` / output paths) and `yt-dlp --exec` runs commands, and the host does not filter their arguments. It starts unticked in the review panel. `exec:any` runs any executable and is called out in red in the UI. |
| `settings`    | Read and write the plugin's own settings namespace. |
| `notify`      | Show desktop notifications. |
| `hooks`       | Subscribe to events (`job:finished`, `job:failed`, `watch-folder:file`). |
| `tools`       | Register the tools declared in `tools` for MCP clients and the TUI. |

The user can approve only some of what a plugin asks for; the plugin still runs and calls to the rest are refused. Adding a permission in an update requires approval again, and the plugin stays off until then.

## Backend API

The backend entry exports `activate` and optionally `deactivate`:

```js
// backend.cjs
exports.activate = async (opnduck) => {
  opnduck.commands.handle('convert-helper.run', async ({ path }) => {
    const id = await opnduck.jobs.start('convert', { inputPath: path, container: 'MP4', mode: 'transcode' })
    return { id }
  })
}
exports.deactivate = async () => {}
```

It runs in a `worker_threads` worker, one per plugin. If it throws or the worker dies, only that
plugin is disabled and the error is logged; OPNduck keeps running.

Everything on `opnduck` is async and permission-checked:

```
opnduck.id, opnduck.version                       plugin id and version (read-only)
opnduck.log(...args)                              written to the plugin's log
opnduck.jobs.start(tool, args) -> jobId           [jobs]   tool and args as in electron/mcp_tools.cjs ('convert', 'download', ...), schema-checked; jobs always write to the download folder. Any *path argument also needs files:read and an allowed path
opnduck.jobs.list() -> [{ id, status, progress, label, error }]   [jobs]  only this plugin's jobs
opnduck.jobs.cancel(id)                           [jobs]
opnduck.files.read(path) -> Buffer                [files:read]
opnduck.files.write(path, data)                   [files:write]
opnduck.files.pick({ save?, filters? }) -> path   [files:read | files:write]   opens a dialog; the picked path becomes allowed
opnduck.exec.run(name, args, { cwd? }) -> { code, stdout, stderr }   [exec]
opnduck.net.fetch(url, init) -> { status, headers, body }   [network]   host must be in manifest "network"
opnduck.settings.get(key) / .set(key, value)      [settings]
opnduck.notify({ title, body })                   [notify]
opnduck.on(event, fn) -> unsubscribe              [hooks]   events carry the job's id, kind, status and label, for every job (not only the plugin's own)
opnduck.tools.handle(name, fn)                    [tools]  fn(args) -> result for a tool declared in the manifest
opnduck.commands.handle(id, fn)                   command palette entry declared in the manifest
opnduck.rpc.handle(name, fn)                      expose fn(arg) to this plugin's own UI
```

Paths are checked on every call: resolved, symlinks followed, and compared against the allowed
folders. A path outside them rejects. Plugin folders that are symlinks are ignored, and a backend
entry that is a symlink leaving its folder is refused. Redirects in `net.fetch` are re-checked
against the hostname list on every hop. A plugin that throws, hangs in `activate` (10 s) or dies is
switched off and logged; it never takes OPNduck down.

## UI entry

Default-export a component:

```js
export default function MyCard({ feature, api }) {
  const { React } = window.OPNduck
  // ...
}
```

`feature` is the card's definition; `api` is the card-safe host API, already bound to your plugin.

Rules:

1. **No bundler assumed.** The entry runs as-is as an ES module: plain JS, no `import` of `react`,
   no JSX unless you compile it yourself. Use `React.createElement` or ship compiled output.
2. **Use the frame's React** from `window.OPNduck.React`, don't bundle a second copy of it.
3. **Style with the app's CSS custom properties and classes** (`--text`, `--text-dim`,
   `--input-bg`, `glass-btn`, `glass-input`, ...), not hardcoded colors, so the card follows the
   user's theme. See `src/index.css` and `src/themes/tokens.css`.

The `api` prop offers the namespaces of the backend API that make sense in a card
(`jobs`, `files.pick`, `settings`, `notify`), all going through the same permission checks, plus:

```
api.rpc.call(name, arg)         call a function the backend registered with opnduck.rpc.handle
```

**A card runs in a sandbox.** OPNduck loads your UI entry into a sandboxed iframe on its own
`opnduck-plugin://<id>/` origin. Inside it:

- `window.OPNduck.React` is a React the frame brings itself (not the app's), and `api` is the only way
  out. Each call travels by `postMessage` to the app, which answers it for your plugin id with the same
  permission checks as before. A card cannot reach the app's window, its storage, `window.opnduckHost` or
  other plugins' calls.
- No network: the frame's content security policy blocks `fetch`, XHR, WebSocket, remote scripts, images
  and fonts, and navigating the frame anywhere but your own plugin folder. To talk to the internet, ask
  your backend over `api.rpc.call` (it needs the `network` permission).
- Not available: `localStorage`, cookies, popups, forms, `alert()`. Keep state with
  `api.settings.get/set` (needs `settings`) or in your backend.
- The app's stylesheet and theme variables are copied into the frame, so `--text`, `glass-btn` and the
  other classes work and follow the user's theme. Its fonts load too.
- Height follows your content automatically (4000 px maximum).
- Your script and its styles/images are served from your plugin folder (only while the plugin is on,
  never the backend file), and the module's default export is rendered as before.

Your **backend** is a different matter: it is Node code running with the user's privileges (see
[Trust](#trust-verified-and-unverified)). The sandbox covers cards only.

### Slot plugins (selector and stage)

A card with `"slot"` set is not a tile. `"selector"` replaces the row of tool tiles on Home and draws
the picker itself (a list, a dock...). `"stage"` keeps the tiles and fills the area below them: the
plugin gets a frame the size of that area, and the open tool's real card is placed in the middle of
it, on top of the frame. A stage plugin controls how visible that real card is with
`api.app.setCardOpacity(0..1)` (for example to hide it while a wheel spins, then show it), and the card
only takes clicks once it is fully visible. A stage plugin can only change that opacity; it cannot
move or read the card. It needs no `tagline`, `icon` or `scope`, no
permissions, and the first selector plugin that is on wins; turn it off and the tiles come back. Its
`api` has one extra part, `api.app`:

```
api.app.features() -> [{ id, title, tagline, icon, iconSvg }]   the tools on Home; iconSvg is the app's own icon as SVG text
api.app.selected() -> id | null                                   which tool is open
api.app.select(id | null)                                         open a tool (or close it with null), like clicking its tile
api.app.setCardOpacity(0..1)                                      stage plugins only: how visible the open tool's real card is
api.app.subscribe(fn) -> unsubscribe                              fn() runs when the list or the selection changes
```

The open tool still shows underneath. A selector can only pick one of the listed tools; it cannot start
jobs or read anything else. See [`plugin-examples/tool-wheel/`](./plugin-examples/tool-wheel/).

## Tools

`tools` entries use the same shape as the built-in tools in `electron/mcp_tools.cjs`:

```json
{
  "name": "convert_helper_run",
  "description": "Convert a file with the Convert Helper preset.",
  "inputSchema": {
    "type": "object",
    "properties": { "inputPath": { "type": "string", "description": "Absolute path to an existing file." } },
    "required": ["inputPath"],
    "additionalProperties": false
  }
}
```

Tool names are prefixed with the plugin id by the host (`<id>__<name>`) so two plugins can never
shadow each other or a built-in. Register the handler with `opnduck.tools.handle(name, fn)`.

Tools are listed for MCP clients (the MCP server must be on, and the desktop app running) and on
the TUI home screen, only while the plugin is on and holds the `tools` permission. Plugins are
approved in the desktop app's Plugins page; the TUI runs the ones approved there and has no
approval screen of its own.

## Safe mode

*Settings → Safe mode* starts OPNduck with all plugins skipped. Use it if a plugin breaks
startup.

## Examples

All four are complete and small; copy one as a starting point.

- [`plugin-examples/hello-world/`](./plugin-examples/hello-world/): UI only, no permissions.
- [`plugin-examples/convert-helper/`](./plugin-examples/convert-helper/): UI card + backend that
  starts a real convert job.
- [`plugin-examples/tool-wheel/`](./plugin-examples/tool-wheel/): a stage plugin: a slowly
  turning wheel of tool cards under the Home tiles that spins to the tool you pick, with the real tool
  in the middle.
- [`plugin-examples/headless-tool/`](./plugin-examples/headless-tool/): backend only, one tool for
  MCP and the TUI.

## Publishing

Plugins are published through the `opnduck-plugins` index repository (`Sight8218/opnduck-plugins`).
Its `index.json` lists each plugin:

```json
{ "plugins": [ {
  "id": "convert-helper", "name": "Convert Helper", "version": "0.1.0",
  "author": "Your Name", "description": "...",
  "repo": "https://github.com/you/opnduck-convert-helper",
  "commit": "<full 40-character commit>",
  "sha256": "<sha256 of the uncompressed tar of that commit>",
  "permissions": ["jobs", "files:read"], "network": [], "verified": false
} ] }
```

- `repo` must be a `https://github.com/<owner>/<name>` URL. An optional `subdir` names a folder
  inside the repo when the plugin is not at the top.
- `sha256` is the hash of the **uncompressed** tar, since gzip output is not byte-stable:
  `curl -L https://codeload.github.com/<owner>/<name>/tar.gz/<commit> | gunzip | sha256sum`
- `permissions` and `version` must match the plugin's own `plugin.json` exactly, or the install is
  refused.
- `verified` is set only when the maintainer has reviewed that commit and merged it.

On install OPNduck downloads the archive of the pinned commit, discards it if the hash differs,
unpacks it (only regular files and folders; links, `..`, absolute paths and oversized archives are
refused), and puts the plugin in place **switched off**. You review its permissions and turn it on
from the Installed tab. An update replaces the folder and switches the plugin off again; only
permissions it did not ask for before need approval.
