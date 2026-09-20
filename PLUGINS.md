# Writing an OPNduck plugin

A plugin is a folder with two files: a `plugin.json` manifest and an entry
script that exports a React component. The Home dashboard renders one card
per registered plugin, using exactly the same mechanism the built-in
Downloader/Converter/Upscaler cards use — see `src/features/registry.ts`.

## Current status: manifest locked, loader not shipped yet

**The manifest format and entry contract below are stable — build against
them now.** What's *not* built yet is the part that reads `plugin.json` off
disk at startup and turns it into a running card automatically. That loader
is intentionally deferred to the Tauri desktop-shell migration (Electron and
Tauri load third-party code very differently, and building the real
mechanism twice isn't worth it). Until then, a finished plugin gets included
by opening a PR — see [Getting a plugin included today](#getting-a-plugin-included-today).

## Where plugins live

Put your plugin's folder here, even before the loader exists — this is the
path the eventual loader will scan, so anything already there just starts
working once it ships:

- Linux/macOS: `~/.local/share/opnduck/plugins/<your-plugin-id>/`
- Windows: `%APPDATA%\opnduck\plugins\<your-plugin-id>\`

## `plugin.json`

```json
{
  "id": "hello-world",
  "name": "Hello World",
  "version": "0.1.0",
  "author": "Your Name",
  "description": "One or two sentences shown on the card.",
  "tagline": "Short subtitle under the title",
  "icon": "★",
  "accent": "rgba(120, 190, 255, 0.45)",
  "scope": "universal",
  "entry": "index.js"
}
```

| Field         | Required | Notes                                                                 |
|---------------|----------|------------------------------------------------------------------------|
| `id`          | yes      | Unique, kebab-case. Becomes the card's React key — don't reuse a core feature's id (`downloader`, `converter`, `upscaler`). |
| `name`        | yes      | Display title.                                                        |
| `version`     | yes      | SemVer.                                                                |
| `author`      | yes      | Whatever you want credited.                                           |
| `description` | yes      | Shown in the card body.                                               |
| `tagline`     | yes      | Shown under the title, e.g. `"MP4 · MKV · WebM"`.                     |
| `icon`        | yes      | A single emoji-free glyph — matches the style of the built-in cards' icons (`⇩`, `⇄`, `⇧`). |
| `accent`      | no       | CSS color for the hover glow, e.g. `"rgba(120, 190, 255, 0.45)"`. Ignored in Monochrome theme by design — don't fight that. |
| `scope`       | yes      | `"universal"` or `"desktop-exclusive"` — controls the badge shown on the card. |
| `entry`       | yes      | Path to your entry file, relative to the plugin folder.               |

## The entry file

Default-export a component with this exact signature:

```js
export default function MyCard({ feature }) {
  // feature is the FeatureDefinition built from your plugin.json
}
```

Three rules, and they're not optional:

1. **No bundler assumed.** The loader will run your entry file as-is — plain
   JS, no import of `react`, no JSX unless you transpile it yourself before
   shipping. Use `React.createElement` directly (see the example) or ship
   already-compiled output.
2. **Use the host's React, not your own.** Read it off `window.OPNduck.React`.
   Bundling your own copy of React means two React instances in one page,
   which breaks hooks in ways that are miserable to debug.
3. **Style with the app's CSS custom properties and utility classes**
   (`--text`, `--text-dim`, `--input-bg`, `glass-btn`, `glass-input`, ...),
   not hardcoded colors. That's what makes your card automatically match
   whichever theme (Glass/Monochrome) the user has picked. Check
   `src/index.css` and `src/themes/tokens.css` for what's available.

## Full example

See [`plugin-examples/hello-world/`](./plugin-examples/hello-world/) in this
repo — a complete, minimal plugin.json + entry.js pair. Copy that folder as
your starting point.

## Getting a plugin included today

Since the dynamic loader isn't live yet, the path to actually running your
plugin right now is a pull request: open one adding your plugin under
`plugin-examples/` (or, if you'd rather it ship as a real feature, propose
folding it into `src/features/` directly). Once the Tauri-era loader lands,
anything already following this manifest format should need little to no
rework to load automatically from the plugins folder above.
