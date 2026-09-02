# Changelog

All notable changes to OPNduck are documented in this file.

## [0.2.0-Pre-Alpha] - 2026-09-02

### Bug Fixes

- Add transparent: true to eliminate frameless window compositor edge

- Monochrome orange bleed, wordmark theming, restore custom scrollbar

- Theme-leak in nav icon glows, page-transition horizontal scrollbar flash

- Restore Settings sticky/scroll, opaque hamburger dropdown, banner placement

- Settings category rail never actually followed scroll

- Flash of destination page before the transition animation starts

- Settings category rail actually follows scroll now

- Sticky/fixed still broken by Framer Motion's persistent transform

- Settings heading overlap, highlight accuracy; add content + dev tools

- GlassTune leaking Glass-only colors into other themes (#1f0508 in Flat)


### Debug / Diagnostics

- Temp instrumentation for sticky nav investigation (to be reverted)


### Documentation

- Add comprehensive session save with full context & continuation guide

- Add complete session #11 chat history


### Features

- Hover highlight on Settings interactive controls


### Miscellaneous Tasks

- Allow direct edits without worktree isolation for live HMR feedback


### Other

- Initial foundation: glass UI, fluid gradient background, dev mode

- Liquid Glass theme engine (glass/flat/monochrome) with translucent surfaces
- Continuous fluid gradient background + baked tuned palette
- Fixed OPNDUCK gradient wordmark (no solid-rectangle render)
- Page swipe transition with motion blur
- Settings: appearance/system/about + new Keybinds category
  with fixed non-changeable Ctrl+Shift+D dev-mode bind
- Dev/debug mode (keybind-only) gating runtime backdrop tuning panel
- Frame titlebar drag regions

- Strip leftover TEMP label, fix misleading state name, JSX indentation

- Simplify GlassTune and StorageCard

- GlassTune: extract repeated Math.max(min, Math.min(max, v)) clamps
  into a clamp() helper; rename hex() parameter so it no longer
  shadows the function name
- StorageCard: extract the duplicated stepper-button className into
  a shared constant

- OPNduck-V0.2.0-Pre-Alpha checkpoint

Checkpoint save covering the diff since the last checkpoint (973ca20)
through 02b6242 (GlassTune/StorageCard simplification), plus a
regression re-check of this session's larger work: Flat theme removal,
Settings category-rail portal fix, GlassTune theme-leak fix, reduce-motion
wiring, and the de-cliché UI pass.

Categories touched: settings/dev-tools-backdrop-tuning,
settings/storage-performance.

- Fixed a stale doc-comment in GlassTune.tsx still referencing the
  removed Flat theme ("Flat/Monochrome" -> "Monochrome"); Theme type is
  now 'glass' | 'monochrome' only.
- Added @category tags with end markers to GlassTune.tsx and
  StorageCard.tsx.
- Verified: tsc -b --noEmit clean, vite build clean, oxlint shows only
  pre-existing warnings in files untouched since before the last
  checkpoint (navContext.tsx, motionPrefs.tsx, devMode.tsx,
  PageTransition.tsx). No regressions found in the portal fix, theme-leak
  fix, or reduce-motion scoping.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGXin5y5bDB9DBmiicbFiT


### Refactor

- Settings category rail is now a fixed, viewport-pinned panel

- Remove Flat theme, de-cliché AI-UI tells, wire reduce motion



