# Audit log

## 2026-09-02 — Save checkpoint: OPNduck-V0.2.0-Pre-Alpha

Scope: diff since prior checkpoint `973ca20` through `02b6242` (Simplify
GlassTune and StorageCard), plus a re-verification sweep of the session's
larger prior work (Flat theme removal, Settings category-rail portal fix,
GlassTune theme-leak fix, reduce-motion wiring, de-cliché pass) since it was
called out as context for this checkpoint.

Found:
- `[STALE TAG]` GlassTune.tsx header comment still referenced the removed
  "Flat" theme ("bled Glass's reddish palette into Flat/Monochrome") —
  Flat was fully removed in `9ea2b62`/`theme.ts` now only has
  `'glass' | 'monochrome'`. SAFE, comment-only.

Auto-fixed (SAFE):
- Corrected the stale Flat-theme reference in GlassTune.tsx's header
  comment.
- Added `@category` tags (settings/dev-tools-backdrop-tuning,
  settings/storage-performance) with end markers to GlassTune.tsx and
  StorageCard.tsx — the only two files actually touched since the last
  checkpoint.

Verified, no regressions:
- `tsc -b --noEmit` clean, `vite build` clean, `oxlint` shows only
  pre-existing warnings in files outside this session's diff
  (navContext.tsx, motionPrefs.tsx, devMode.tsx, PageTransition.tsx —
  all unchanged since before `973ca20`, out of scope).
- `mixBlack`/`hex` param-shadow fix and the `STEP_BTN_CLASS` dedup in
  `02b6242` are behavior-neutral; call sites in DevTools.tsx and
  Settings.tsx unchanged.
- Flat theme fully gone from `src/` except doc-comment prose describing
  visual style (not the removed theme) — no leftover imports/branches.
- Settings category rail portal (`createPortal` to `document.body` in
  Settings.tsx, consumed by SettingsNav.tsx) still fixed/viewport-pinned,
  not tracking scroll.
- Reduce-motion setting (`motionPrefs.tsx`) still scoped only to Home's
  card hover-lift-glow (`FeatureCard.tsx`) as documented; page transitions
  and SettingsNav's spring indicator deliberately left ungated — consistent
  with the stated design intent, not a bug.

Nothing RISKY pending — this was a small, clean diff.
