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

## 2026-09-20 — Full session audit / checkpoint save (v0.2.0-Alpha)

Scope: entire uncommitted working tree (18 modified + 5 new files) — real
yt-dlp download pipeline (electron/main.cjs, preload.cjs, src/host/*,
src/features/downloader/*, src/pages/Downloads.tsx, src/lib/{useTasks,
downloadPrefs,formatBytes}.ts, src/components/{Thumbnail,Tag}.tsx) plus UI
bug fixes (FeatureCard, HamburgerMenu, NavBar, NavMenuCards, PageTransition,
PreAlphaBanner, StorageCard, Settings, index.css).

Findings: none. Read every changed/new file in full, checked the
main-process <-> preload <-> host-interface <-> UI contract end to end,
verified every new export is actually referenced (no dead code), ran
`tsc -b --noEmit` and `oxlint` (clean — pre-existing warnings only, none
introduced this session), and `node -c` on main.cjs. No bugs, no
over-engineering, no stale tags found. The portal/settled-state/scroll-spy
fixes in HamburgerMenu, PageTransition, and Settings are all backed by
real, correctly-reasoned inline explanations of the underlying browser/
Framer Motion behavior — not defensive guesswork.

Action: added @category tags (block-scoped, with end markers) to the new
downloader feature files to match the codebase's existing (very sparse —
2 prior instances) tagging convention: DownloaderCard.tsx, Downloads.tsx,
useTasks.ts, downloadPrefs.ts, Thumbnail.tsx, and the task-orchestration
IPC block in main.cjs. Left formatBytes.ts and Tag.tsx untagged — genuinely
generic utility/UI, not feature-specific.

Committed as b2212f0 "OPNduck-V0.2.0-Alpha checkpoint: real yt-dlp
downloading + UI fixes" (23 files changed, all of the above).
