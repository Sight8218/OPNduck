### Fixed

- Jobs started from Home now keep showing their progress after you navigate
  away and back, and the card's button stays disabled while they run.
  Previously leaving the page made the card forget its jobs, so it was easy to
  start duplicates by accident (for example 50 upscales).
- Video Upscaler and Frame Interpolation now return their task immediately, so
  a progress bar appears right away instead of only after the whole job
  finished.

### Added

- Drag & drop: drop files onto the Converter, Image Upscaler, Video Upscaler
  and Interpolation cards, and drag a link onto the Downloader. Dropping a file
  elsewhere in the window no longer replaces the whole UI.
- Library history now persists across launches, with Open folder, Run again
  and Clear finished.
- Per-card presets (Downloader, both Upscalers, Interpolation). The Converter
  gets one-click format presets and "Save as preset" in the format picker.

### Tauri migration: still POSTPONED

Unchanged: the Tauri v2 migration is archived on the `tauri-migration-phase1`
branch but is **postponed and not shipping**. Tauri uses WebKitGTK on Linux,
which stutters/lags and can segfault with hardware compositing on the NVIDIA
proprietary driver under Wayland (an upstream platform bug, not an OPNduck
bug). OPNduck stays on **Electron**.

### Known issues

- Windows installers are built from Linux via wine and are untested on Windows.
- Drag & drop of real files from a file manager was only tested at the code
  path level, not by hand.
- No AUR publication and no artifact signing yet (deferred).


## Checksums (SHA256)

```
60111aa5a29bb8f105ddfea6ac8a46eef68ef3f4cdd3498feeeff6227623ca78  OPNduck-0.3.2-alpha.AppImage
0a22766d3a416b29f505eefdf84873799e4e2ed8148630c4966ea112dcf26ea8  OPNduck.0.3.2-alpha.exe
f7b151e8f4e8c594a246090929bf56d5646db23d9c918a16247051e51afca197  opnduck-desktop-0.3.2-alpha.pacman
77e37ede2e404ea892390cb938229af6972ee30565cab066dfa176fdc30facc2  OPNduck.Setup.0.3.2-alpha.exe
```
