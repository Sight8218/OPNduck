Hotfix. **Everyone on v0.3.0-Alpha should upgrade.**

### Fixed

- **Critical: installed/packaged v0.3.0-Alpha builds opened a blank,
  transparent window.** `electron/main.cjs` passed a bare filesystem path to
  `win.loadURL()`, which no longer navigates on Electron 44.7 (it worked on
  44.1). The built UI is now loaded with `win.loadFile()`. Dev mode was
  unaffected, which is why it was not caught before release. The packaged
  Linux build was verified to render before this release was published.
- Batch conversions are now capped at 2 running at once.
- Video upscale/interpolate outputs are always `.mp4`.
- Cancelling a LibreOffice conversion now kills the whole process tree (no
  orphaned `soffice.bin`).

### Security / hardening

- Only `http(s)` links are accepted; IPC requests are validated; Spotify
  lookups are restricted to `open.spotify.com`.
- A Content-Security-Policy was added to the renderer.

### Changed

- Full keyboard navigation in dropdowns.
- Command-palette downloads now offer the playlist choice.

### Tauri migration: still POSTPONED

Unchanged from 0.3.0: the Tauri v2 migration is archived on the
`tauri-migration-phase1` branch but is **postponed and not shipping**. Tauri
uses WebKitGTK on Linux, which stutters/lags and can segfault with hardware
compositing on the NVIDIA proprietary driver under Wayland (an upstream
platform bug, not an OPNduck bug). OPNduck stays on **Electron**.

### Known issues

- Windows installers are built from Linux via wine and are untested on Windows.
- No AUR publication and no artifact signing yet (deferred).


## Checksums (SHA256)

```
49f18b19495a7b795be7f552eaaea2a6ea8079576096cec2b1363df475b287df  OPNduck-0.3.1-alpha.AppImage
1268dc3f640fb6cc622af1d2b5a6849469f37c4eeee14d7aa38505e47cd09040  OPNduck.0.3.1-alpha.exe
7e1853399eb0ef6d23eb225eafe52c075306ba483aa4518320b3a6c19905005d  opnduck-desktop-0.3.1-alpha.pacman
6fceb6752a1edbf6b52e23e2d68cfa83caddd51ef074c85a748f7eec9c6fe397  OPNduck.Setup.0.3.1-alpha.exe
```
