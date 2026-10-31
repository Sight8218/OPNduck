# OPNduck v0.5.0-Beta

Free, open source (GPL-3.0), local-first: your media never leaves your machine. Expect bugs and report them on GitHub.

The performance release. Video upscaling now streams frames straight through the GPU (PyTorch) with no temporary
image files, AI video jobs encode on the GPU (NVENC), and long videos run in bounded-size chunks. It also adds a
trimmer, a watch folder, queue controls, live logs, all Omarchy 4.5 themes and developer tools. The Tauri migration
is still **postponed** (WebKitGTK on Linux stutters/crashes with NVIDIA + Wayland); OPNduck stays on Electron.

### Added

- **One-click installs:** missing Python tools can be installed from the card itself. AI Audio sets up
  Demucs and Subtitles sets up faster-whisper inside OPNduck's own Python environment (progress shown,
  cancelable). The manual command stays visible.
- **yt-dlp** can be downloaded and updated from inside OPNduck (checksum-verified, no admin rights);
  Settings → Downloads shows the version and an Update button.
- **Spotify tracks:** pasting a link switches the format to MP3, and "Run again" on a failed match
  asks, then picks a different YouTube video (premieres are skipped).
- New app icon (the website duck).
- `packaging/aur/PKGBUILD` for an Arch package that runs on the system `electron`.
- A "How many" limit for channel and search links in the command-palette download panel, and a notice
  when some files of a batch couldn't be started.

- **Watch folder:** Settings → Watch folder converts new media files dropped into a chosen folder (checked every 10
  seconds; files still being copied are left alone; results go to a `converted` subfolder; each file is handled once).
- **Trim card:** cut a section out of a video or audio file. *Fast cut* copies the streams (instant, snaps to the
  nearest keyframe); *Precise* re-encodes for an exact frame.
  **Open visual trimmer…** shows a pop-up with a thumbnail timeline, two draggable handles (or ← → keys) and a live
  preview of the frame at the handle you are moving.
- **Queue controls:** *Pause queue* in the Library stops waiting jobs from starting (running ones finish), *Run next*
  moves a queued job to the front of its line, and Settings → Job queue sets how many downloads (1–6) and
  conversions (1–4) run at once.
- **All Omarchy 4.5 themes built in:** Settings → Appearance now lists every theme from Omarchy 4.5.0-rc2 (23, including
  the new **Jade Horse** and **Starship**), plus **Osaka Jade**, which rc2 dropped but stays here as a swatch picker. They work on any system, not just where Omarchy is
  installed, share the Omarchy look and keep your choice between launches. "Synced with Omarchy" still follows your live
  theme and picks up new Omarchy themes automatically.
- **Dev launcher (`npm run desktop:dev`):** only one dev session at a time. Starting it again stops the previous one
  (Vite and Electron) instead of piling up windows, frontend edits hot-reload, backend edits (`electron/*.cjs`, `.py`)
  restart the app automatically, and closing the app stops everything it started. Normal launches are also
  single-instance now: opening OPNduck again just brings the open window forward.
- **Developer tools additions:** a performance overlay (FPS, JS heap, DOM nodes), a theme token viewer with color
  chips and Copy as CSS, a local-storage editor, and window-size presets.
- **More developer utilities** (Settings → Developer tools, with dev mode on, Ctrl+Shift+D): system and tool versions
  (OPNduck, Electron, Chromium, GPU, yt-dlp, ffmpeg, upscalers, Python, PyTorch), live per-process CPU and memory, an
  app log viewer with level filters, a raw tasks inspector, buttons for DevTools, reload, the data folder and a test
  notification, simulated jobs (success or failure) to try the UI, and **Copy diagnostics** — a bug-report text with
  your home folder and any credentials removed.
- **Notifications and tray:** Settings → Notifications & tray. A desktop notification when jobs finish while OPNduck
  isn't the focused window (a batch becomes one notification), and an option to keep running in the system tray
  when you close the window so jobs and subscription checks continue.
- **Download extras:** a checkbox embeds cover art and tags (title, artist) into MP3, MP4 and MKV files (FLAC gets
  tags only). Subtitles can be **translated to English** (new checkbox on the Subtitles card; output `name.en.srt`).

### Fixed

- **Progress bars no longer jump backwards.** A download's video and audio streams each restarted the bar from
  0%; progress is now weighted by stream size, never moves backwards while a job runs, and every bar eases
  toward the reported value instead of snapping.
- **Frame Interpolation** failed with "only rife-v4 model support custom numframe" on installs whose RIFE
  defaults to an older model; it now uses `rife-v4.6`.
- Subtitles failed with "unexpected keyword argument 'metadata_errors'" when the system PyAV didn't
  match faster-whisper; audio is now decoded with ffmpeg. Songs no longer come out empty (the speech
  filter is retried off), and a file with no speech reports that instead of saving an empty .srt.

### Changed

- **Electron 45.2.0** (Chromium 156, Node 24.22). Release notes for 45.0–45.2 reviewed: nothing in OPNduck uses the
  removed sandbox preload globals, the changed ASAR `fs.open` behaviour, or the deprecated `safeStorage`. New in
  OPNduck from it: the taskbar/dock icon shows the overall progress of running jobs (`setProgressBar`, now working on
  Linux launchers too), the "job finished" notification has a **Show in folder** button, and the window remembers its
  position, size and maximized state between launches (not visible on tiling window managers, which set the size).

### Security

- Updated Electron to 44.10.0 and refreshed dependencies; `npm audit` now reports 0 vulnerabilities (Electron, undici
  and fast-uri advisories).

### Performance

- **Faster video upscaling engine (PyTorch, NVIDIA):** frames now stream ffmpeg → GPU → ffmpeg through pipes with
  no temporary image files at all. End to end on an RTX 3080 it was about 1.4–1.8× faster than the classic engine
  at 2× and 2.3–3.6× faster at 4× (output quality matches: SSIM 0.993). Settings → GPU jobs picks Auto or Classic
  (ncnn); the Video Upscaler card offers a one-click install (about 5 GB) when it isn't set up. Model weights are
  official Real-ESRGAN releases downloaded once, checksum-pinned. Any failure falls back to the classic engine
  automatically, and cancelling removes the partial file.
- **GPU video encoding (NVENC):** AI video jobs encode on the GPU when it works (H.264 up to 4096 px wide, HEVC
  above), falling back to x264 on any failure. Settings → GPU jobs can force the CPU.
- **Show live logs:** every task card (and each Library row) has a "Show live logs" toggle that tails what the
  job's tools are printing right now (yt-dlp, ffmpeg, the upscalers, Whisper, Demucs) plus the pipeline's own
  steps (e.g. "Chunk 2 of 5: upscaling"). Logs live in memory only.
- **GPU subtitles (NVIDIA):** the Subtitles card offers a one-click "Add GPU support" (about 2.3 GB: the CUDA 12
  runtime libraries Whisper's GPU engine needs, installed into OPNduck's own Python environment, nothing
  system-wide). In testing a 20-second clip with the `small` model took 5 s instead of about 45 s on the CPU. If
  the GPU can't be used, subtitles still fall back to the CPU automatically.
- **AI models stay loaded between files:** AI Audio (Demucs) and Subtitles (Whisper) now run in a background
  worker that keeps the model in memory, so a batch only pays the load cost once (second Demucs job: 4.3 s →
  0.9 s on a 20-second clip). The worker exits after 60 s idle so it doesn't hold GPU memory, and cancelling a
  job simply restarts it.
- **Long videos no longer need huge temp space:** video upscaling and frame interpolation now work in
  chunks (the video is split without re-encoding, each chunk is processed and encoded on its own, then the
  chunks are joined with the original audio). Temp disk use is bounded by one chunk (about 2.5 GB) instead of
  every frame of the video; a 12-second test clip dropped from 226 MB to 59 MB (upscale) and 74 MB to 21 MB
  (interpolate) with identical frame counts and duration. Each chunk reloads the model, so very short clips
  can take a little longer.
- **Smaller install:** the app archive no longer carries 105 MB of UI libraries that were already bundled
  into the page (50 MB → 1.4 MB), and only the English Chromium locale ships. Unpacked app 332 → 276 MB,
  AppImage 136 → 124 MB. Library, Settings and Plugins load when first opened (main script 549 → 492 KB).
- **Faster AI video jobs:** the upscaler and frame interpolator now load, process and save frames in
  parallel (measured on an RTX 3080: video upscale ~27% and interpolation ~20% faster end to end on a
  small clip; up to 2× on the GPU step alone). Settings → GPU job speed has a *Low memory* mode for older
  GPUs, and a job that fails right away on the fast setting retries once on the conservative one.
- The Library no longer re-sends and re-renders hundreds of finished rows on every progress tick, and
  long histories load 60 at a time. Stale temp folders from interrupted jobs are cleaned at startup.

### Known issues

- Windows installers are built from Linux via wine and are still untested on real Windows.
- The PyTorch upscaling engine, NVENC and GPU subtitles need an NVIDIA GPU; other GPUs use the classic engine.
- No AUR publication and no artifact signing yet (deferred).
