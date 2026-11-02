## What this changes

<!-- One or two sentences. Link the issue if there is one: "Closes #123". -->

## Why

## How I tested it

<!-- What you ran or clicked. For a job, the real file you used. -->

## Checklist

- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass
- [ ] `npm run tui:build` passes (if I touched `electron/core/` or `tui/`)
- [ ] I added or updated tests for new logic
- [ ] I added a line under `Unreleased` in `CHANGELOG.md`
- [ ] The UI only uses `window.opnduckHost`, and nothing is sent anywhere unless the user asks for it
- [ ] New source files have the GPL header
