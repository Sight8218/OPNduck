# Contributing to OPNduck

Thank you for wanting to help. OPNduck is a local-first media tool made by one developer, so a short note first:

- **Be patient.** Reviews can take a while, and not everything fits. Small, focused changes get merged fastest.
- **Nobody is paid.** This is a free, open-source (GPL-3.0) project.
- **Core or plugin?** If a feature is only for some people (a niche format, a service), a [plugin](../PLUGINS.md)
  is usually the right home. Tell me in the issue and we will work out which it is.

## Before you start

1. Search the [issues](https://github.com/Sight8218/OPNduck/issues) to see if it is already reported.
2. For anything bigger than a small fix, open an issue first so we agree on the idea before you spend time on it.
3. Read the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Reporting a bug

Use the **Bug report** form. The most useful reports say the OPNduck version (bottom right of the app), your
operating system, what you did, what happened and what you expected. For a failed job, copy the last lines of its
log (the job row in the Library has a log button). Do not post cookies, tokens or private files.

Security problems do **not** go in public issues: see [SECURITY.md](./SECURITY.md).

## Suggesting a feature

Use the **Feature request** form. Say what you are trying to do, not only the solution you imagine.

## Making a change

```bash
git clone https://github.com/Sight8218/OPNduck.git
cd OPNduck
npm install
npm run desktop:dev      # the app with hot reload
npm run tui              # the terminal version
```

You need Node.js 20 or newer, and ffmpeg on your PATH. Some tools need more (yt-dlp, Real-ESRGAN, Python for the
AI tools); the app's Setup window lists them.

Rules the project follows, so your pull request fits:

- **One engine.** Jobs live in `electron/core/` and are shared by the desktop app, the terminal app and MCP. A new
  tool needs its core module, an entry in `electron/mcp_tools.cjs`, the terminal form, the desktop card and tests.
- **The UI talks to the app only through `window.opnduckHost`** (`src/host/`), never to Electron directly.
- **Local-first.** No accounts, no telemetry, nothing sent anywhere unless the user presses a button that says so.
- **Style.** Match the surrounding code, keep the GPL header on new source files, and write short comments that
  explain *why*.
- **Checks.** These must pass before you open the pull request:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run tui:build     # if you touched electron/core/ or tui/
```

- **Changelog.** Add a line under `Unreleased` in `CHANGELOG.md` for anything a user would notice.
- **Commits.** Short, in plain words, for example `fix(converter): keep the audio when remuxing`.

## Plugins

Plugins are published through the [opnduck-plugins](https://github.com/Sight8218/opnduck-plugins) index. The format,
permissions and the review checklist are in [PLUGINS.md](../PLUGINS.md).

## Licence

By contributing you agree that your work is licensed under the [GPL-3.0](../LICENSE), the same as the project.
