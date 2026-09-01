# OPNduck Session Save — Complete Context & Continuation Guide

## Project Overview
**OPNduck v0.2.0-Pre-Alpha** — Local-first media processing workspace (Electron desktop application).

### Technology Stack
- **Frontend**: React 18 + TypeScript + Vite
- **Styling**: Tailwind CSS v4 + CSS custom properties (CSS variables)
- **Desktop Shell**: Electron (Node.js, no Rust)
- **State Management**: React Context (NavProvider, DevModeProvider)
- **Routing**: BrowserRouter (react-router-dom)
- **Animation**: Framer Motion
- **Build Tool**: Vite with `base: './'`

### Design & Themes
- **Glass Theme**: Warm orange (`#b35a2d`) animated blobs, translucent surfaces, 16px blur backdrop filter
- **Flat Theme**: Solid colors, no blur, performance-optimized
- **Monochrome Theme**: Neutral grays with subtle grain texture, accessibility-focused
- **Component Library**: Custom `.glass` class for translucent panels with glassmorphism effects

### Project Status
- **Version**: 0.2.0-Pre-Alpha
- **Scope**: Desktop shell + Settings page only (core features framework in place)
- **License**: GPL-3.0
- **Repository**: https://github.com/Sight8218/OPNduck (unpushed, awaiting public release)
- **Platform Focus**: Linux (X11/Wayland), Hyprland window manager

---

## Directory Structure

```
/home/ducky/Work/opnduck/
├── electron/
│   ├── main.cjs                 # Electron main process, BrowserWindow config
│   ├── preload.cjs              # IPC preload script (contextIsolation enabled)
│   └── (launcher configuration)
├── src/
│   ├── App.tsx                  # Root React component (routers, providers)
│   ├── index.css                # Global CSS, Tailwind layers, .glass class, animations
│   ├── main.tsx                 # React entry point
│   ├── components/
│   │   ├── FluidBackground.tsx  # Animated blob background (fixed, z-index -2)
│   │   ├── NavBar.tsx           # Top navigation bar with menu
│   │   ├── PageTransition.tsx   # Route transition animations (Framer Motion)
│   │   ├── PreAlphaBanner.tsx   # Yellow warning banner
│   │   ├── VersionFooter.tsx    # Bottom-right version badge
│   │   ├── CommandPalette.tsx   # Command/search palette
│   │   ├── AdaptiveCardGrid.tsx # Feature card grid (responsive)
│   │   ├── FeatureCard.tsx      # Individual feature card component
│   │   ├── NavMenuCards.tsx     # Top nav menu cards
│   │   ├── HamburgerMenu.tsx    # Mobile/compact menu
│   │   ├── SocialLinks.tsx      # Social icon links
│   │   ├── WindowControls.tsx   # Custom window minimize/maximize/close
│   │   ├── GlassSelect.tsx      # Themed select dropdown
│   │   ├── GlassTune.tsx        # Settings control component
│   │   ├── SlidingSelector.tsx  # Theme/option selector slider
│   │   ├── ThemeToggle.tsx      # Theme switcher
│   │   ├── InfoCard.tsx         # Information card template
│   │   ├── NavDisplayCard.tsx   # Navigation display variant
│   │   └── HardwareAllocation.tsx # Hardware info component
│   ├── pages/
│   │   ├── Home.tsx             # Main dashboard page
│   │   ├── Downloads.tsx        # Downloads page
│   │   ├── Plugins.tsx          # Plugins/extensions page
│   │   ├── Settings.tsx         # Application settings
│   │   ├── downloader/          # Download feature module
│   │   ├── converter/           # Media converter feature module
│   │   ├── upscaler/            # Upscaler feature module
│   │   ├── modules.ts           # Feature registration system
│   │   ├── registry.ts          # Feature registry & discovery
│   │   └── (other features)
│   ├── themes/
│   │   ├── tokens.css           # Theme token definitions (Glass, Flat, Monochrome)
│   │   ├── theme.ts             # Theme application logic
│   │   └── (theme utilities)
│   ├── lib/
│   │   ├── devMode.tsx          # Dev mode context provider
│   │   ├── navContext.tsx       # Navigation display mode context
│   │   ├── nav.ts              # Navigation item definitions
│   │   └── (utility functions)
│   ├── features/
│   │   └── modules.ts           # Core feature registration
│   ├── host/
│   │   ├── index.ts             # Host/plugin API definitions
│   │   └── electron.ts          # Electron-specific host implementation
│   └── main.tsx                 # React DOM render entry
├── public/
│   ├── icons/
│   │   ├── github.png
│   │   ├── discord.png
│   │   └── (other icons)
│   └── index.html               # Static HTML template
├── index.html                   # Vite entry HTML
├── package.json                 # Node dependencies & scripts
├── package-lock.json
├── vite.config.ts              # Vite build config (base: './')
├── tsconfig.json               # TypeScript configuration
├── tsconfig.app.json
├── tailwind.config.ts          # Tailwind CSS config
├── SESSION_SAVE.md             # This file
└── history.md                  # Session-by-session development log
```

---

## Critical Bug Fix (Session #11 — This Session)

### Problem: Gray Window Frame
**Symptom**: A persistent `53,53,53` gray border (~2-4px) appeared on the left, right, and bottom edges of the OPNduck window.

### Investigation Process
The user suspected the gray frame was caused by:
1. The app's CSS/theme rendering
2. Hyprland window manager border settings
3. The glass theme's orange rendering

### Systematic Diagnosis: Layer-by-Layer Stripping
To isolate the source, we methodically removed app layers one at a time, checking the frame after each removal:

1. **Layer 1**: Removed panels/cards (AdaptiveCardGrid, PreAlphaBanner, VersionFooter) → Frame persisted
2. **Layer 2**: Removed NavBar component → Frame persisted
3. **Layer 3**: Removed scrollbar (not present in this version) → Skipped
4. **Layer 4**: Disabled `backdrop-filter: blur()` on `.glass` class → Frame persisted
5. **Layer 5**: Hidden fluid blobs (`opacity: 0` on `.fluid-blob`) → Frame persisted
6. **Layer 6**: Removed `<FluidBackground />` component entirely → Frame persisted
7. **Layer 7**: Set `body { background-color: transparent }` in `src/index.css` → Frame persisted
8. **Layer 8**: Set `index.html` inline `<style>` body background to transparent → Frame persisted
9. **Layer 9**: Set Electron `backgroundColor: '#00000000'` + **`transparent: true`** → **Frame ELIMINATED**

### Root Cause
The gray frame was a **Chromium frameless window compositor edge** on X11/XWayland. Frameless Electron windows (`frame: false`) without the `transparent: true` flag get a thin compositor-drawn border artifact.

**NOT caused by**:
- Hyprland (proven via Tokyo Night theme comparison showing blue border on other apps)
- App CSS (proven via complete content stripping)
- Theme rendering (proven via full glass theme neutralization test)

### The Fix
**File**: `/home/ducky/Work/opnduck/electron/main.cjs`

Added `transparent: true` to the BrowserWindow constructor:

```javascript
const win = new BrowserWindow({
  width: 1280,
  height: 820,
  minWidth: 940,
  minHeight: 600,
  title: 'OPNduck',
  transparent: true,              // ← THIS FIX
  backgroundColor: '#00000000',
  frame: false,
  titleBarStyle: 'hidden',
  autoHideMenuBar: true,
  webPreferences: {
    preload: path.join(__dirname, 'preload.cjs'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  },
})
```

**Result**: Gray frame completely eliminated. Window now truly transparent with no compositor edge.

---

## Current Working State

### Electron Configuration
- **File**: `/home/ducky/Work/opnduck/electron/main.cjs`
- **Window Options**:
  - `width: 1280`, `height: 820`
  - `minWidth: 940`, `minHeight: 600`
  - `frame: false` (no native titlebar)
  - `titleBarStyle: 'hidden'`
  - `transparent: true` (FIX APPLIED)
  - `backgroundColor: '#00000000'`
  - `sandbox: true` (security hardened)
  - `contextIsolation: true` (IPC security)

### CSS Architecture
- **File**: `/home/ducky/Work/opnduck/src/index.css`
- **Structure**:
  - Unlayered `html`, `body`, `#root` (transparent, height 100%)
  - `.fluid-background`: `position: fixed; inset: 0; z-index: -2;` with animated gradients
  - `.glass`: Glassmorphism surfaces (backdrop blur, translucent background, border)
  - `.fluid-blob-1` through `.fluid-blob-6`: Animated blob shapes (Glass theme only)
  - Tailwind layers: `base`, `components`, `utilities`

### Theme System
- **File**: `/home/ducky/Work/opnduck/src/themes/tokens.css`
- **Themes**: Glass (warm orange, animated), Flat (solid, performant), Monochrome (neutral, accessible)
- **Token Types**: Colors, gradients, blur, shadows, opacities
- **Application**: Via `[data-theme='glass']` / `[data-theme='flat']` / `[data-theme='monochrome']` selectors
- **Switching**: `applyTheme(themeName)` in `src/themes/theme.ts`

### Development Server
- **Command**: `npm run desktop:dev`
- **What it does**:
  - Starts Vite dev server on `http://localhost:1420`
  - Launches Electron (concurrently with Vite)
  - HMR enabled for hot reload
- **Manual server** (if needed): `npm run dev` (Vite only)

### Build
- **TypeScript Check**: `npm run typecheck`
- **Production Build**: `npm run build` (runs `tsc -b && vite build`)
- **Electron Build**: `npm run desktop:build`
- **Electron Start**: `npm run desktop:start`

---

## Previous Sessions (1-10) — Development History

### Session #1: Crash Diagnosis
- Investigated a Brave renderer crash (unrelated to OPNduck)
- Diagnosed as V8 JIT bug, not OPNduck issue
- Closed

### Sessions #2-5: Foundation & Design
- Set up React + TypeScript + Tailwind v4
- Implemented theme system (Glass, Flat, Monochrome)
- Designed glass-morphism components
- Built NavBar and page transitions

### Session #6: v0.2.0 Frontend Foundation
- Stabilized routing (BrowserRouter)
- Finalized component library
- Set up feature module system

### Sessions #7-9: Live Feedback & Polish
- Refined glass theme visuals
- Added Dev Mode (developer-facing debug tools)
- Optimized gradient rendering
- Fixed visual inconsistencies

### Session #10: Scrollbar & Menu Fixes
- **Fixed red scrollbar leak**: Removed duplicate `--bg-base` gradient from `html`; added `--bg-solid` flat token
- **Fixed menu-swipe flicker**: Replaced live `<Routes>` children in PageTransition with stable `PAGES` module-level map
- **Investigated gray border**: Hypothesized (incorrectly) that duplicate gradient caused it; later disproven

### Session #11 (This): Gray Frame Resolution
- Conclusively diagnosed gray frame as Chromium compositor edge
- Applied `transparent: true` fix to Electron BrowserWindow
- Verified fix eliminates frame completely
- Restored full app functionality

---

## Key Design Decisions (Locked)

1. **Liquid Glass Aesthetic** → Long-term target is Tauri at beta/RC; Electron for now (Node only)
2. **Tailwind v4 + CSS Custom Properties** → Standard approach for dynamic theming
3. **Linux-First** → X11/Wayland focus; Windows/macOS secondary
4. **Pre-Alpha Scope** → Shell + Settings only; core framework for feature cards in place
5. **Frameless Window** → Custom window controls; `frame: false` with transparent background
6. **HashRouter vs BrowserRouter** → Currently BrowserRouter; may switch to HashRouter later
7. **Vite `base: './'`** → Assets load from relative path
8. **Hyprland Integration** → Window class `opnduck-desktop` for WM rules; do NOT edit Hyprland config without explicit user approval

---

## Hyprland Configuration (User Constraints)

**File**: `~/.config/hypr/hyprland.lua`

**User Directive**: "DO NOT TOUCH HYPRLAND except for the OPNduck window rule."

**Current Rule** (added during investigation, benign):
```lua
o.window("opnduck-desktop", { border_size = 0 })
```
This removes Hyprland's window border for OPNduck only. It does NOT affect other apps and is safe to keep.

**Why it's there**: During the frame investigation, we verified that Hyprland's border (`#8d8d8d` blue or `#595959` gray) was NOT the source. This rule was added to eliminate Hyprland's border (which worked), but the gray frame persisted until `transparent: true` was applied to Electron.

---

## Testing & Verification Protocol

After making changes, verify:

1. **Build Success**: `npm run typecheck` (no errors)
2. **Dev Server**: `npm run desktop:dev` (app launches without crashes)
3. **Visual Check**: 
   - Switch themes (Glass → Flat → Monochrome)
   - Check window edges (no gray frame, no artifacts)
   - Navigate between pages (smooth transitions)
   - Test responsive layout on desktop
4. **Console**: No errors or warnings (except pre-existing lint warnings)

---

## Next Steps (For Continuation)

1. **Verify the fix across all themes**: Restart app, switch themes, confirm no frame regression
2. **Commit the fix**: Create a clean commit message explaining the `transparent: true` solution
3. **Resume roadmap**:
   - Per-card accent tints (subtle theme colors on feature cards)
   - Monochrome accessibility enhancements
   - Download queue UI (show active/completed downloads)
   - Plugin marketplace UI
   - Windows packaging (later)
4. **Keep Hyprland untouched** unless explicitly directed otherwise

---

## Continuation Instructions for Next AI Session

**You are continuing OPNduck development.** The user has been systematically building this app and just solved a visual bug (gray window frame). They are methodical, thorough, and test-driven.

### Tone & Style
- **Not impatient**: Take time to understand context before suggesting changes
- **Methodical**: Follow the user's preferred workflow (layer stripping, pixel verification, systematic testing)
- **Transparent**: Explain reasoning; show results visually (screenshots, pixel scans)
- **Efficient**: Use tools effectively (pixel scanners, layer-by-layer debugging) rather than guessing

### Key Behaviors
1. **DO NOT EDIT HYPRLAND** without explicit user request (user has strong directive)
2. **Follow user's chosen options** — don't propose unilaterally; let them decide
3. **Use proven debugging methods**: Layer stripping, pixel verification, systematic testing
4. **Assume continuity** — understand all prior sessions; don't ask "what happened before"
5. **Keep `transparent: true` in Electron** — this is the fix for the gray frame
6. **Test themes & visuals after changes** — verify no regression
7. **Use TodoWrite for multi-step work** — break tasks into trackable steps
8. **Commit with clear messages** — reference what was fixed and why

### Preferred Workflow (Based on This Session)
- When investigating a visual issue: capture screenshots, use pixel scanners, strip layers methodically
- When implementing CSS/theme changes: test across all three themes (Glass, Flat, Monochrome)
- When making Electron changes: restart the app to apply; note which changes require restart vs HMR
- When stuck: step back, gather data, systematically test hypotheses

---

## Files Modified This Session

- **`/home/ducky/Work/opnduck/electron/main.cjs`**: Added `transparent: true`
- **Session commit**: Included all generated context & stripper scripts in `/tmp/opencode/pxscan/`

---

**Last Updated**: September 1, 2026 (Session #11)
**Status**: Gray frame fix applied & verified
**Next Session Starter**: Continue with roadmap items or investigate other issues using the proven debugging methodology
