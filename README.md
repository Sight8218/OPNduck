# OPNduck Desktop Suite 🦆

OPNduck is a local-first, open-source media processing suite. It brings powerful AI
upscaling, motion frame-interpolation, media downloads, conversions, and transcription
directly to your local GPU/CPU at zero cost — no subscriptions, no cloud, no spying. All
your media stays on your machine.

This is **v0.2.0-Pre-Alpha**: a full rewrite of the frontend on a new design system
(Liquid Glass) with the web/desktop split architecture from the ground up. It is the
**shell only** — GUI, routing, theming, settings, and the adaptive card dashboard. The
download/convert/AI engines start working in the Alpha phase.

---

## 🎨 The "Liquid Glass" Design System

The defining visual identity of OPNduck:

- **Vibrant fluid background** — a base layer of animated, wavy warm gradients (deep
  reds, bright oranges, yellows).
- **Glass overlay engine** — every component (nav bar, cards, buttons) renders like
  physical frosted glass using heavy `backdrop-filter` blurs.
- **Translucent tinting** — a faint white overlay tint lifts every container off the
  background.
- **Light refraction & edges** — crisp 1-px inner borders catch light on glass edges,
  with soft drop shadows beneath cards.
- **Interactive modules** — inputs and "Run Task" buttons are slightly darker, inset
  modules that match the glass but look pressable.

### Theme Engine (two modes)

Switching happens in Settings → UI Theme:

| Mode | Description |
| ---- | ----------- |
| **Glass** (default) | The flagship translucent, backdrop-blurred aesthetic over the fluid gradient. |
| **Monochrome** | Strict high-contrast black & white for maximum readability and minimal distraction. |

Themes are implemented as CSS custom-property tokens switched by a single
`data-theme` attribute on `<html>` — components never change, only tokens do.

---

## 🛠️ Built On & Technologies Used

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, React Router, Framer Motion.
- **Desktop Shell (now)**: Electron — temporary during pre-alpha/alpha for speed.
- **Desktop Shell (beta/RC)**: Tauri v2 (Rust Core IPC) for lower RAM and portability.
- **Sidecar Engine (Master Engine)**: Python 3, packaged via PyInstaller.
- **AI Upscaler**: Real-ESRGAN (NCNN-Vulkan C++ Binary).
- **AI Interpolator**: RIFE (NCNN-Vulkan C++ Binary).
- **Media Downloader**: yt-dlp.
- **Universal Converter**: FFmpeg (Hardware Accelerated).
- **Beat / Tempo Finder**: librosa.
- **Subtitles Generator**: faster-whisper (Tiny Whisper Model).

> The native sidecars above are **not wired in yet** — they land in the Alpha phase.

---

## 🖥️ Platform Support

- **Linux** — primary target, fully tested (currently in development on Arch Linux).
- **Windows** — first-class from the start; cross-platform scripts and path handling
  are baked in.
- **macOS** — planned later.

---

## 🌟 Key Feature Modules

1. **Media Downloader**: Download individual video/audio files or entire playlists from
   YouTube, TikTok, SoundCloud, and Spotify up to 8K resolution.
2. **Universal Transcoder**: Convert media formats using hardware-accelerated local
   FFmpeg pipelines. Supports both individual files and batch folder directories.
3. **AI Video Interpolator**: Increase frame rates (e.g. 24fps to 60fps) using local
   RIFE networks.
4. **AI Video Upscaler**: Reconstruct detail textures up to 4× using precompiled local
   Vulkan Real-ESRGAN engines.
5. **AI Image Upscaler**: High-speed, local neural super-resolution for image assets.
6. **Local BPM & Beat Finder**: Analyze tracks locally with librosa to extract BPM and
   find exact slice timestamps for editing.
7. **Local Subtitle Generator**: Free transcription using local faster-whisper models
   to export synchronized `.SRT` and `.VTT` tracks.

### Feature split

- **Universal (Web & Desktop)**: Media Downloader, Format Converter.
- **Desktop-exclusive (hardware intensive)**: AI Video Interpolation, AI Video & Image
  Upscaling, Community Plugin Ecosystem, Hardware Allocation Engine.

---

## 🚀 Setup & Local Execution

### 1. Prerequisite Installations

- **Node.js** (LTS v20+)

### 2. Install & run

```bash
npm install
npm run dev        # dev server → http://localhost:1420
npm run build      # type-check + production build
npm run preview    # preview the production build
npm run lint       # oxlint
```

The frontend runs in any browser today — it is the exact bundle the desktop shell
hosts. The Electron wrapper and native sidecars are wired in the Alpha phase.

---

## 📝 Project Metadata & Licensing

- **Project State**: `v0.2.0-Pre-Alpha` (shell/GUI only — expect bugs!)
- **Original Developer**: Aaron
- **Development Model**: Built with the architectural assistance of AI.
- **License**: [GPL-3.0](./LICENSE) — free software. Copyright © 2026 Aaron Jonsson.

---

## ⚠️ An honest note from the developer

This project is made completely by AI/vibe-coding with human input and testing. If you
don't like that, sorry — I'm a single developer and can't afford to build all of this
alone. If you want to contribute and work on this project alongside me, you're welcome,
but don't expect to be paid anything.

Found a bug? Got a feature idea? Submit it — I'll review whether it belongs in OPNduck
core or should be a community plugin. **EXPECT BUGS.** 🦆
