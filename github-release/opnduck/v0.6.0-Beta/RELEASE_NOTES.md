# OPNduck v0.6.0-Beta

> **This is the biggest update yet for OPNduck, and possibly ever. It might be super buggy. Expect bugs, and please report them on [GitHub Issues](https://github.com/Sight8218/OPNduck/issues).**

Free, open source (GPL-3.0), local-first: your media never leaves your machine unless you point an AI feature at a cloud key yourself. About 65 commits and 30,000 lines changed since v0.5.3-Beta, most of it new and lightly tested. Back up anything you care about and tell us what breaks.

### Added
- **Send to OPNduck**: links from your phone or browser land in OPNduck (off by default). Works through an `opnduck://` link, a direct connection (this computer, Tailscale or home network), or an encrypted ntfy relay. Includes a Chrome/Firefox extension and a phone web page. It only ever carries a link; nothing downloads without you. See `docs/SEND.md`.
- **OPNduck Server** and an **Android companion**: run OPNduck headless on another machine and send or follow jobs from your phone. Sharing is per device: phones and extensions only see and manage the jobs they started, desktops (paired with `--admin`) see everything.
- **macOS build (Beta)**: universal dmg and zip, built and smoke-tested in CI only. Not notarized. Not included in this release's assets. See `docs/MACOS.md`.
- **AI runtime, Chat and a local model** (Settings > AI, off by default): use Ollama, LM Studio, another computer, or a cloud API with your own key. A Chat page proposes jobs as cards that only run when you press Run. OPNduck can download its own small model (Ministral 3 3B or Qwen3 1.7B) and run it on this computer. A model can be shared to your paired devices.
- **Recipes**: chain tools into one saved flow.
- **Colour Grade**: auto-fix, six looks, .cube LUTs, reference matching, sliders with a live before/after.
- **Background Remover**: pictures and video, transparent or replaced background.
- **Dubbing (Beta)**: make a video speak another language, all locally.
- **Beat Finder**: BPM, beats and key, tap tempo, tag writing, cut video to the beat.
- **Also new**: Compress, GIF & Stickers, Music Tagger, Auto settings, a plugin system (beta), Spoken words search with summaries and chapters, "Why did this fail?" help, a thumbnail picker, Tidy name for downloads, community files.
- Full list: `CHANGELOG.md`.

### Fixed
- A round of code-audit fixes: remote jobs wrongly refused, upload bookkeeping, look-alike private hostnames, AI engine downloads now need a published checksum, jobs from another device are never forwarded to a third, the ntfy relay reconnects after silence, resumed downloads can't corrupt files, chats save to the right chat, Grade and Dubbing cope with odd audio and subtitle tracks.

### Assets
- `OPNduck-0.6.0-beta.AppImage`, `opnduck-desktop-0.6.0-beta.pacman` (Linux x64)
- `OPNduck.Setup.0.6.0-beta.exe`, `OPNduck.0.6.0-beta.exe` (Windows x64 installer and portable)
- `opnduck-tui-0.6.0-beta.tar.gz` (terminal version, needs Node.js 20 or newer)
- `SHA256SUMS.txt`

### Known issues
- Expect bugs. This is a very large Beta.
- Windows installers are built from Linux via wine and are still untested on real Windows.
- The Android companion and macOS build are not attached to this release.
- No AUR publication and no artifact signing yet (deferred).
