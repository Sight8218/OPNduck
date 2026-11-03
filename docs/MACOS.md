# OPNduck on macOS (Beta)

A universal build runs on Apple silicon and on Intel Macs (macOS 12 or newer).

## Install

1. Download `OPNduck-<version>-universal.dmg` from the GitHub release and drag OPNduck to Applications.
2. **First launch.** Without an Apple Developer account the app is only ad-hoc signed, so macOS asks you to confirm it once:
   open it, dismiss the warning, then System Settings > Privacy & Security > scroll down > **Open Anyway**.
3. Install the tools OPNduck uses, with Homebrew:
   ```sh
   brew install yt-dlp ffmpeg
   brew install --cask libreoffice      # optional, for document conversion
   ```
   OPNduck adds Homebrew's folders to its own PATH, so these are found even though a Dock-launched app has no shell PATH.
4. Optional: the AI upscaler and frame interpolator use the `-macos` downloads of Real-ESRGAN and RIFE
   (<https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan/releases>, <https://github.com/nihui/rife-ncnn-vulkan/releases>). Put the
   programs in `~/Applications/OPNduck-tools/` or anywhere on your PATH.

## What is different from Windows and Linux

- Hardware video encoding uses VideoToolbox instead of NVENC.
- PyTorch jobs (the fast video upscaler, vocal remover) use the Mac's GPU through Metal when there is one, else the CPU.
- Subtitles (Whisper) run on the CPU; there is no GPU backend for it on a Mac.
- The window uses the system's own traffic-light buttons, and shortcuts show **⌘** instead of Ctrl.
- Smart scheduling's heat guard reads only NVIDIA and AMD sensors, so on a Mac it does nothing; "hold on battery" works.

## Honest status

Built and smoke tested on a Mac runner in CI (the window opens, Settings opens, the tools are found, a real conversion
finishes), but not yet used day to day on real hardware. Please report what you find.
