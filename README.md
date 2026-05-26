# OPNduck Desktop Suite 🦆

OPNduck is a local-first, open-source media processing suite built using **Tauri v2**, **React (TypeScript)**, and **Tailwind CSS v4**. It features high-performance, Vulkan-accelerated upscaling and interpolation engines, audio transient analysts, and transcription.

---

## 🛠️ Built On & Technologies Used
* **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4.
* **Core Runner**: Tauri v2 (Rust Core IPC).
* **Sidecar Engine (Master Engine)**: Python 3, packaged via PyInstaller.
* **AI Upscaler**: Real-ESRGAN (NCNN-Vulkan C++ Binary).
* **AI Interpolator**: RIFE (NCNN-Vulkan C++ Binary).
* **Media Downloader**: yt-dlp.
* **Universal Converter**: FFmpeg (Hardware Accelerated).
* **Beat / Tempo Finder**: librosa.
* **Subtitles Generator**: faster-whisper (Tiny Whisper Model).

---

## 🚀 Setup & Local Execution

### 1. Prerequisite Installations
* **Node.js** (LTS v20+)
* **Rust** (Cargo toolchain)
* **C++ Compiler Platform** (Windows Build Tools)
* **Python 3.11+**

### 2. Configure Python Virtual Environment
Navigate to the `sidecar/` directory:
```bash
cd sidecar
python -m venv venv

A modern, local-first desktop application built for high-performance video, audio, and image processing. OPNduck relies entirely on local execution—bringing powerful AI upscaling, motion frame-interpolation, conversions, and transcription directly to your local GPU/CPU at zero cost.

### 🌟 Key Feature Modules
1. **Media Downloader**: Download individual video/audio files or entire playlists from YouTube, TikTok, SoundCloud, and Spotify up to 8K resolution.
2. **Universal Transcoder**: Convert media formats using hardware-accelerated local FFmpeg pipelines. Supports both individual files and batch folder directories.
3. **AI Video Interpolator**: Increase frame rates (e.g. 24fps to 60fps) using local RIFE networks.
4. **AI Video Upscaler**: Reconstruct detail textures up to 4x using precompiled local Vulkan Real-ESRGAN engines.
5. **AI Image Upscaler**: High-speed, local neural super-resolution for image assets.
6. **Local BPM & Beat Finder**: Analyze tracks locally with librosa to extract BPM and find exact slice timestamps for editing.
7. **Local Subtitle Generator**: Free transcription using local faster-whisper models to export synchronized .SRT and .VTT tracks.

### ⚙️ System Architecture & Stack
* **UI & Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4.
* **Desktop Wrapper**: Tauri v2 (Rust Core).
* **Task Engine (Master Engine)**: Python 3 sidecar executable compiled with PyInstaller.
* **Graphic Compute Layer**: Cross-platform Vulkan API (natively accelerates on NVIDIA, AMD, and Intel GPUs with no complex drivers).

### 📝 Project Metadata & Licensing
* **Project State**: `Alpha Release v1.0.0` (Active development, expect bugs!)
* **Original Developer**: Aaron
* **Development Model**: Built with the architectural assistance of AI.
* **License**: OPNduck Limited Open Source License (OLOS). Free to download, run, and customize. Strictly prohibits direct cloning, re-packaging, and re-publishing identical copies under other authorship.