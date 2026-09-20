# Changelog

All notable changes to OPNduck are documented in this file.

## [0.2.0-Alpha] - 2026-09-20

### Other

- Release prep: v0.2.0-Pre-Alpha changelog, README, release manifest

Adds git-cliff config and generated CHANGELOG.md covering the full
project history (first tagged release), removes the retired Flat
theme from the README's theme table, and stages a release manifest +
Discord draft under github-release/opnduck/v0.2.0-Pre-Alpha/ for
manual review. No tag created, nothing published - typecheck/lint/
build and secret scans (gitleaks, trufflehog) all passed clean.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGXin5y5bDB9DBmiicbFiT

- Add electron-builder packaging for Arch and Windows

Configures electron-builder targets: AppImage + pacman for Linux/Arch,
NSIS installer + portable exe for Windows. Adds app icon (rasterized
from the existing favicon.svg) and required package.json metadata
(author, homepage) that electron-builder needs for the pacman
maintainer field.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGXin5y5bDB9DBmiicbFiT

- Initial commit

- Add files via upload

- "Claude PR Assistant workflow"

- "Claude Code Review workflow"

- Merge pull request #1 from Sight8218/add-claude-github-actions-1788358309915

Add Claude Code GitHub Workflow

- Revise README for v0.2.0-Pre-Alpha release

Updated README to reflect new design system and project state.

- Merge origin/main: reconcile with real GitHub repo, bring in CI workflows

# Conflicts:
#	.gitignore
#	README.md
#	index.html
#	package-lock.json
#	package.json
#	tsconfig.json
#	tsconfig.node.json
#	vite.config.ts

- Add UI screenshots to README

Captured the home and settings screens via a headless-Chromium render
of the dev build so the README shows the actual current UI instead of
just prose, for people browsing the repo for the first time.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGXin5y5bDB9DBmiicbFiT

- Add combined OPNduck logo (duck + open-source keyhole mark)

Composited from a rubber-duck icon and an open-source keyhole logo:
duck mirrored to face left, sized up, transparent background.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGXin5y5bDB9DBmiicbFiT

- OPNduck-V0.2.0-Alpha checkpoint: real yt-dlp downloading + UI fixes

Wires up the actual download pipeline (yt-dlp task queue, quality/bitrate
selection, size-estimate probing, thumbnails) through a new Host.tasks
seam, and fixes several UI bugs: theme-glow leaking into Monochrome,
Settings scroll-spy skipping short sections, page-slide degrading to a
fade-only animation, nav-bar overflow/clipping, hamburger-menu dropdown
clipping (portaled to document.body), window minimum-size enforcement on
Wayland, and app-wide scrollbar removal.

Audited this session's full diff: no bugs, dead code, or unused exports
found — everything new is exercised and typechecks/lints clean. Added
@category tags to the new downloader feature files to match the existing
(sparse) tagging convention in this codebase.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>



