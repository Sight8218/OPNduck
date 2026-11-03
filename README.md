# OPNduck Desktop Suite 🦆

OPNduck is a local-first, open-source media tool. It upscales images and video, interpolates
frames, downloads, converts, trims, shrinks files to fit a size limit, tags your music, makes GIFs and stickers, cuts the silences out of talks, removes backgrounds, finds the BPM and key of a song and cuts video to the beat, chains tools into recipes, takes links sent from your phone and transcribes, all on your own GPU/CPU. No subscription,
no cloud; your files stay on your machine.

> **v0.6.0-Beta is the biggest update yet for OPNduck, and possibly ever. It might be super buggy: expect bugs, and please report them on [GitHub Issues](https://github.com/Sight8218/OPNduck/issues).**

This is **v0.6.0-Beta**, which adds Send to OPNduck (links from your phone and browser), Recipes, Colour Grade, Background Remover, Dubbing, Beat Finder, an AI runtime with Chat and an optional local model, the OPNduck Server, an Android companion and a macOS beta. It follows v0.5.3-Beta, which added the **OPNduck TUI** (the tools in a terminal, about 100 MB of memory) and a first-launch setup wizard, and v0.5.2-Beta, a visual follow-up to v0.5.1-Beta and the v0.5.0-Beta performance release: Home is a compact grid of tool tiles with one tool open at a time, there is a themed startup screen, a pixel look, sharper corners, plainer wording, faster engine checks and more developer tools. The v0.5.1-Beta release added control by any MCP-capable AI app (Settings → System, off by default) and animated menu icons. The v0.5.0-Beta release brought the performance work. Video upscaling now streams frames through the GPU
(PyTorch, NVIDIA) with no temporary image files, about 1.4-3.6x faster than the classic engine in testing, and
AI video jobs can encode on the GPU (NVENC). Long videos are processed in chunks so temp disk use stays small,
and AI Audio and Subtitles keep their models loaded between files. New tools include a visual **trimmer**, a
**watch folder**, queue controls (pause, run next, parallel limits), **live logs** on every task, one-click
installs for missing Python tools, GPU subtitles, all 23 Omarchy 4.5 themes as built-in palettes, and
developer tools. It builds on the v0.4.0 Downloader (8K, subtitles, channels and lists, sign-in, Smart mode),
Subscriptions, AI Audio (Demucs), Subtitles (faster-whisper), Library management, the multi-format Converter,
AI upscalers, frame interpolation, theming and the adaptive card dashboard. The Tauri migration is **postponed** (see Desktop Shell below); OPNduck ships on Electron.
AI Audio needs a Python venv with `torch`, `demucs` and `soundfile`; OPNduck can install them for you
(the install is large, about 5.5 GB including the CUDA libraries).

<p align="center">
  <img src="docs/screenshots/home.png" alt="OPNduck home screen — Downloader, Converter and AI upscaler cards in the Blarange theme" width="49%" />
  <img src="docs/screenshots/settings.png" alt="OPNduck settings screen — theme, background, icon, and motion controls" width="49%" />
</p>

---

**Terminal version:** `npm install -g opnduck-tui` (Node 20 or newer), then `opnduck-tui`, runs the same tools in a terminal (about 100 MB of memory); see [docs/TUI.md](docs/TUI.md).

## 🎨 Design System

OPNduck uses a flat, solid look: no blur, no translucency. (Earlier builds used a
"Liquid Glass" style; that theme was flattened and renamed Blarange in v0.3.0.)

### Theme Engine

Switching happens in Settings → Appearance:

| Mode | Description |
| ---- | ----------- |
| **Blarange** (default) | Flat black + orange, matching the OPNduck website's palette. |
| **Monochrome** | Strict high-contrast black & white for maximum readability and minimal distraction. |
| **Synced with Omarchy** | Only shown on an Omarchy desktop; follows its live theme colors. |

Themes are implemented as CSS custom-property tokens switched by a single
`data-theme` attribute on `<html>`. Components never change, only tokens do.

---

## 🛠️ Built On & Technologies Used

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, React Router, Framer Motion.
- **Desktop Shell**: Electron. A full Tauri v2 migration was built and verified
  (Rust backend, all feature pipelines ported, Windows sidecars vendored; kept on a local
  `tauri-migration-phase1` branch that isn't published on GitHub), but is **postponed, not shipping**: on Linux with
  an NVIDIA proprietary driver under Wayland, Tauri's webview (WebKitGTK) can't do
  hardware-accelerated compositing — it either segfaults, or falls back to a
  software-rendering path so slow the app is barely usable (confirmed against the
  identical build running fine in a normal browser, so this is a WebKitGTK/NVIDIA/Wayland
  platform bug, not an OPNduck bug). This is a known, long-standing upstream issue, not
  something fixable from application code. Revisit once it's resolved upstream, or if
  packaging specifically for Windows (WebView2, unaffected) or non-NVIDIA Linux.
- **Sidecar Engine (Master Engine)**: Python 3, packaged via PyInstaller.
- **AI Upscaler**: Real-ESRGAN (NCNN-Vulkan C++ Binary).
- **AI Interpolator**: RIFE (NCNN-Vulkan C++ Binary).
- **Media Downloader**: yt-dlp (wired in, real downloads).
- **Universal Converter**: FFmpeg (Hardware Accelerated).
- **Beat / Tempo Finder**: librosa.
- **Subtitles Generator**: faster-whisper (wired in, via your own Python 3 with
  `faster-whisper` installed; set `OPNDUCK_PYTHON` to use a venv's interpreter).

> Wired in now (as system binaries on the PATH): `yt-dlp`, FFmpeg, LibreOffice,
> Real-ESRGAN and RIFE, plus faster-whisper through your own Python. The Python sidecar
> and librosa are **not wired in yet**.

---

## 🖥️ Platform Support

- **Linux** — primary target, fully tested (currently in development on Arch Linux).
- **Windows** — first-class from the start; cross-platform scripts and path handling
  are baked in.
- **macOS** — Beta (Apple silicon and Intel, one universal dmg). It is built and smoke tested on a Mac in CI, but nobody has used
  it day to day yet. The app is not notarized unless the project has an Apple Developer account, so the first launch needs
  "Open Anyway" (see `docs/MACOS.md`). Install the tools with `brew install yt-dlp ffmpeg`.

---

## 🌟 Key Feature Modules

1. **Media Downloader**: Download individual video/audio files or entire playlists from
   YouTube, TikTok, and SoundCloud up to 8K resolution. (Not Spotify — its tracks are
   DRM-protected and there's no legitimate way to pull audio directly from it.)
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
hosts. The Electron wrapper, downloader, converter, upscalers and interpolation are
wired in, as is Subtitles (faster-whisper).

---

## 📝 Project Metadata & Licensing

- **Project State**: `v0.6.0-Beta` (the biggest update yet, possibly ever, and it might be super buggy — expect bugs and report them!)
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