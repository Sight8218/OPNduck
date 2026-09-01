# OPNduck Session Save — Full Context

## Project Overview
**OPNduck v0.2.0-Pre-Alpha** — Local-first media processing workspace (Electron desktop app).
- **Tech**: Vite + React (TypeScript) + Tailwind v4 + Electron
- **Themes**: Glass (warm orange animated blobs), Flat (solid), Monochrome (neutral grain)
- **Status**: Shell + Settings only. Pre-Alpha.
- **GitHub**: https://github.com/Sight8218/OPNduck (unpushed, GPL-3.0)
- **Dev**: `npm run desktop:dev` (Vite + Electron), `http://localhost:1420`

## Current Working State
- **Electron**: `frame: false`, `transparent: true`, `titleBarStyle: 'hidden'`
- **Router**: `BrowserRouter` (HashRouter used earlier in sessions)
- **CSS**: Tailwind v4 + CSS custom properties; `base: './'` in vite.config
- **Background**: `.fluid-background` (fixed, full-viewport) with animated glass blobs (Glass theme only)
- **Build**: `tsc -b && vite build`

## Critical Fix (Session #11 — THIS SESSION)
**Gray window frame problem SOLVED:**
- **Root cause**: Chromium frameless window compositor edge on X11 → `53,53,53` gray border around window
- **Not** Hyprland (proven via Tokyo Night blue border comparison)
- **Not** app CSS (proven via layer-by-layer stripping)
- **Fix**: Added `transparent: true` to Electron BrowserWindow options in `electron/main.cjs`
- **Result**: Gray frame eliminated; window now truly transparent

### Stripping Experiment (Methodology)
Stripped app one layer at a time, checking frame after each:
1. Panels/cards removed → frame persisted
2. NavBar removed → frame persisted
3. Scrollbar (skipped, not in this version)
4. Glass blur filter disabled → frame persisted
5. Fluid blobs hidden → frame persisted
6. FluidBackground component removed → frame persisted
7. Body/HTML backgrounds → frame persisted
8. Electron backgroundColor transparent + **`transparent: true`** → **frame GONE**

**Conclusion**: Compositor edge was caused by missing `transparent: true` on frameless Electron window.

## Previous Sessions (1-10) Summary
- **#1**: Brave crash diagnosis (unrelated, closed)
- **#2-5**: UI foundation, theme system, glass design
- **#6**: v0.2.0 frontend foundation
- **#7-9**: Live UI feedback, Dev mode, gradient/glass refinement
- **#10**: Scrollbar red leak fixed, menu-swipe flicker fixed, gray border investigated (incorrect hypothesis: duplicate gradient)

## Key Files & Paths
- **App entry**: `src/App.tsx` (BrowserRouter, DevModeProvider, NavProvider, FluidBackground, NavBar, PageTransition, CommandPalette)
- **Main Electron**: `electron/main.cjs` (now has `transparent: true`)
- **Themes**: `src/themes/tokens.css` (Glass/Flat/Monochrome token sets)
- **Background**: `src/components/FluidBackground.tsx` (6 animated blobs + scrim + wash layers)
- **CSS root**: `src/index.css` (Tailwind + custom layers, `.glass` class, `.fluid-background`)
- **Pages**: `src/pages/Home.tsx`, `Downloads.tsx`, `Plugins.tsx`, `Settings.tsx`
- **Components**: NavBar, PageTransition, PreAlphaBanner, VersionFooter, CommandPalette, AdaptiveCardGrid, etc.

## Locked Decisions
- Liquid Glass (animated orange blobs) → WIP, targeting Tauri at beta/RC
- Electron now (Node only, no Rust)
- Tailwind v4 + CSS custom properties
- Linux-first (X11/Wayland)
- Pre-Alpha scope: shell + settings only
- `HashRouter` later; currently `BrowserRouter`
- `vite.config.ts` has `base: './'`
- Class `opnduck-desktop` for window rules

## Hyprland Config (Current)
- File: `~/.config/hypr/hyprland.lua`
- **DO NOT TOUCH** (user strict directive after earlier attempts)
- One rule added: `o.window("opnduck-desktop", { border_size = 0 })` to remove WM border (benign, stays)

## Dev Notes
- HMR active on `http://localhost:1420`
- Typecheck: `npm run typecheck`
- Lint: `npm run lint` (pre-existing warnings only)
- Preload: `electron/preload.cjs` with contextIsolation:true
- Sandbox: true (security hardened)

## Next Steps (User Context for Next Session)
1. Verify gray frame gone on all themes (switch themes, restart app, check frame)
2. Commit the `transparent: true` fix if verified
3. Continue with roadmap: Per-card accent tints, Monochrome accessibility, download queue UI, etc.
4. Keep Hyprland untouched (user's directive)

---

## INITIALIZATION FOR NEXT AI
**YOU are continuing OPNduck development. The user has been working on this since early session, dealing with a gray compositor window frame bug. THEY JUST FIXED IT by adding `transparent: true` to Electron's BrowserWindow.**

**Tone**: Direct, efficient, no fluff. User is cost-conscious and hates repetition.

**Key behaviors**:
- Do NOT edit Hyprland config (`~/.config/hypr/`) — user explicitly forbade it
- Follow user's chosen options, don't propose unilaterally
- Use pixel scanners + layer stripping for debugging (proven effective here)
- Speak like you understand every prior session; don't ask "what happened before"
- Keep `transparent: true` in Electron BrowserWindow (the fix)
- Test themes/borders/frame visually after changes
- Use TaskWrite to track multi-step work
- Commit frequently with clear messages

**The user is skilled, impatient, and testing-focused. Match their pace.**
