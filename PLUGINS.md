# Writing an OPNduck plugin

A plugin is a folder with a `plugin.json` manifest and up to two scripts:

- a **UI entry**: a React card that shows up on the Home grid (desktop app only), and/or
- a **backend entry**: a Node script that runs in its own worker, can start jobs, read files,
  call the network and register tools. It loads in the desktop app, the terminal app (TUI)
  and the MCP server.

Either part is optional. A plugin with only a `backend` and `tools` is a "headless" plugin: no
card, but its tools show up for MCP clients and in the TUI.

> **Status: spec v2 (apiVersion 1).** The host (permissions, backends, tools) and the desktop loader
> (cards on the Home grid) work today. The in-app plugins page and the store are still being built;
> until then, enable a plugin by dropping its folder in and approving it from the plugins page when
> it lands. Fields marked *planned* arrive with the store. Manifests from the old v1 format (single `entry`, no permissions) still load,
> as a UI-only plugin with no permissions.

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
| `ui`          | no       | `{ "entry": "ui.js" }`: path relative to the plugin folder. v1's top-level `entry` is read as `ui.entry`. |
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
| `exec`        | Run the binaries OPNduck already manages (`ffmpeg`, `yt-dlp`, ...) by name. `exec:any` runs any executable and is called out in red in the UI. |
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
2. **Use the host's React** from `window.OPNduck.React`. A second copy of React breaks hooks.
3. **Style with the app's CSS custom properties and classes** (`--text`, `--text-dim`,
   `--input-bg`, `glass-btn`, `glass-input`, ...), not hardcoded colors, so the card follows the
   user's theme. See `src/index.css` and `src/themes/tokens.css`.

The `api` prop offers the namespaces of the backend API that make sense in a card
(`jobs`, `files.pick`, `settings`, `notify`), all going through the same permission checks, plus:

```
api.rpc.call(name, arg)         call a function the backend registered with opnduck.rpc.handle
```

**A card is not isolated from the app.** Its script runs inside OPNduck's own window, so code in a
card can reach everything the app's UI can (including the bridge the app itself uses), not just
`api`. The permission checks protect the `api` and the backend; they cannot hold back a card
that goes around them. Treat an unverified card like an unverified backend: read it first.

The script and its styles/images are served from the plugin's folder over `opnduck-plugin://<id>/`
(only while the plugin is enabled, only inside its folder, never the backend file). Export a
default component from the entry; it is loaded as an ES module.

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

All three are complete and tiny; copy one as a starting point.

- [`plugin-examples/hello-world/`](./plugin-examples/hello-world/): UI only, no permissions.
- [`plugin-examples/convert-helper/`](./plugin-examples/convert-helper/): UI card + backend that
  starts a real convert job.
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
