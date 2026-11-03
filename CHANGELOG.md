# Changelog

All notable changes to OPNduck are documented in this file. Generated with
[git-cliff](https://github.com/orhun/git-cliff) from Conventional Commit
history; entries are curated for readability.

## [Unreleased]

## [0.6.0-Beta] - 2026-11-03

The biggest update yet for OPNduck, and possibly ever. It might be super buggy: expect bugs and report them on GitHub.

### Added
- **Send to OPNduck** (first part): links from other devices land in OPNduck. Turn it on in Settings (off by default). An `opnduck://send?url=…` link (from a web page, a launcher or the command line) puts the link in a banner on Home with Download and Dismiss; it never downloads by itself, even if you chose "Download straight away", because any web page can open such a link. Under the hood there is an encrypted message format (AES-256-GCM, keys derived from one pairing secret that stays on your computer), an inbox that drops junk, old and repeated messages and allows at most 30 a minute, and a rule that a remote message can only ever carry a link: the format, quality and folder come from your own settings ("Download as", default MP4 best quality). Downloads that came this way show a "via link" tag in the Library. 
- **Send to OPNduck, direct connection:** an optional small server (off by default) that your phone or browser can send links to. Choose who can reach it: only this computer, this computer plus your Tailscale network, or (advanced) the whole home network. It only answers a health check and one request that needs your private key, never serves files, refuses anything over 8 KB, and only lets the project page and browser extensions call it from a web page. Settings shows a QR code and a copy button for the pair link, a Reset pairing button, the server status, and (for Tailscale) your Tailscale address and an "Enable HTTPS over Tailscale" button that runs `tailscale serve` for you (or shows the exact command if Tailscale does not allow it). 
- **Send to OPNduck, relay:** links can also reach OPNduck from anywhere through ntfy (https://ntfy.sh by default, or your own server with an access token). OPNduck listens to a private channel named from your pairing key; every message is encrypted on the sending device, so the server only sees random text and the time. It reconnects by itself (waiting 2 seconds, doubling up to 60), asks for what it missed so links sent while OPNduck was closed arrive on the next start (ntfy.sh keeps 12 hours), and shows its live status in Settings. The relay server must use https. 
- **Send to OPNduck, browser extension and phone page:** a Manifest V3 extension for Chrome and Firefox (`npm run build:extension`) with right-click "Send to OPNduck" on links, videos, audio and pages and a toolbar button. It tries OPNduck on this computer, then Tailscale, then the encrypted relay, and only asks the browser for permission to the relay or Tailscale address you paired with. A phone page (a web app you can add to your home screen, with Android share-menu support and a "Paste & send" button for iPhones) does the same. The message code is shared and checked against one committed test vector in Node and in a real browser. Full guide: `docs/SEND.md`.
- **Background Remover** (new tool): cut a person or object out of a picture or video with no green screen and put a transparent background (PNG, or WebM or ProRes video with alpha), a flat colour, a blurred copy of the scene or another picture behind it, with a one-frame preview. Pictures use rembg; video uses RobustVideoMatting (official weights, checked against a pinned checksum, run through onnxruntime: no code is downloaded). Needs a one-click add-on (about 150 MB) and downloads its models the first time.
- **Dubbing** (new tool, Beta): make a video speak another language, all on your computer. The voice is split from the music (Demucs), written down (Whisper), translated (Argos Translate, with English as the bridge between other languages), spoken by a free Piper voice and fitted into the timing of each line; the music dips while it speaks and the picture is not re-encoded. The dub is added as the first audio track (the original stays as the second) or replaces the audio. Voice cloning is not included. One-click add-on; the translation pack and voice download the first time you use a language. Also available as the `dub_video` MCP tool, in recipes, in the TUI and on a server.
- **Thumbnail picker** (Library > Spoken words panel > Thumbnail): finds a good still of a video and saves it next to it as a JPEG. Dark, fade and blurry frames are skipped by measurement; with an AI model that can see pictures it chooses the most inviting frame (it only answers with a frame number).
- **AI model in the tray:** with OPNduck's own model chosen, the tray menu has Load / Eject for it.
- **AI evals:** `npm run ai:eval` (with `AI_EVAL_URL` and `AI_EVAL_MODEL`) runs OPNduck's real AI prompts against a model and checks the answers, for when a prompt changes or you try a new model.
- **Fixed:** the terminal app's Ask screen cut messages to one character when the terminal did not report its size.
- **The assistant can change app settings and the theme** (you confirm each change with a card, like jobs): ask for a colour or a theme ("something green", "osaka-jade"), reduce motion, compact density, the background, developer mode, and most settings in Settings (notifications, tray, parallel jobs, scheduling, the AI itself, and more). Sharing, link servers, the MCP server, cloud keys and providers, other computers' addresses, cookies and sign-in, folders and shutting down stay in Settings by hand. It also knows where each setting is, and can no longer invent themes.
- **Settings are sorted into 8 categories** instead of five with a long System list: Appearance, Keybinds, Downloads & files (downloads, music tagging, watch folder), Queue & performance (queue, scheduling, hardware, GPU, notifications), AI assistant, Connections (Send to OPNduck, Servers, MCP), System and About.
- **More compact Home:** while a tool is open, the tool tiles shrink to a small strip (and the logo and the beta notice shrink) so the tool is in view without scrolling; tool cards use less padding; the last row of tool tiles stretches to fill the full width, so a lone tile (GIF & Stickers) is no longer left with an empty gap.
- **Menu icons:** Recipes and Chat now have their own animations (the chef's hat puffs up and tips; the speech bubble pops with three typing dots) instead of borrowing the Library's.
- **Fixed:** a model server left over from an earlier OPNduck run (after a crash or restart) kept the graphics memory, so loading the model failed with "failed to create context"; it is now stopped before a new one starts.
- **Code audit fixes:** remote background-remover jobs were wrongly refused; uploads named `meta.json` or counted forever against the limit; hostnames like `100.x.evil.com` passing as private addresses; the AI engine download now needs a published checksum; jobs from another device never get forwarded on to a third; the shared AI status no longer shows this computer's folders; Grade and Dubbing no longer fail on odd audio or subtitle tracks and the dub no longer runs 3 s past the video; the ntfy relay reconnects when the connection goes silent; resumed result downloads cannot corrupt the file; the model list is no longer fetched with your cloud key for other devices; chats save to the right chat.
- **Sharing is now per device:** a device is only a desktop (sees every job, manages devices) if the pairing code was made for one (`opnduck-server pair --admin`; the first device on a new server is the owner); phones and extensions see, cancel, delete and download only the jobs they started. Pair codes made by older versions count as phones. Cancelling a background removal now also stops its FFmpeg helpers; a long local-model answer is no longer ejected as idle; the desktop and the server share one AI-sharing implementation; Dubbing voices and the server image's upscaler and yt-dlp downloads are checked against checksums.
- **Share the AI model**: a desktop that shares its engine, or an OPNduck Server, offers its AI model (OPNduck's own, Ollama or LM Studio, never a cloud key) to your paired devices in the OpenAI format; another OPNduck uses it through "Another computer" in Settings > AI. **Tidy name**: a button on finished downloads that removes clutter like "[Official Video]" and "(4K)" from the file name, with the new name shown first.
- **OPNduck's own AI model** (Settings > AI > "On this computer"): downloads a small open model (Ministral 3 3B, about 3 GB, sees pictures; or Qwen3 1.7B, about 1.1 GB) and the llama.cpp engine, both checked against their published checksums and resumable, into a folder you can move to another disk. It runs only on this computer, loads when you first ask something, can load at start, and ejects after 5 to 60 idle minutes. Also: token use per month with an optional monthly limit for cloud providers, and an Ask screen in the terminal app (Ctrl+T moves on while typing).
- **macOS build (Beta)**: a dmg and zip for Apple silicon, built and smoke tested on a Mac in CI. Homebrew tools are found even from the Dock, hardware encoding uses VideoToolbox, PyTorch jobs use Metal, the window uses the system traffic lights, there is an application menu so ⌘C/V/X/A/W/Q work, and shortcuts show ⌘. Not notarized until the project has an Apple Developer account. See `docs/MACOS.md`.
- **Why did this fail?** A "Why?" button on failed Library rows gives a plain-language reason for the errors people actually hit (a site wanting a login, an out-of-date yt-dlp, a full disk, a GPU out of memory, a damaged file and more), with a button for the fix when there is one (update yt-dlp, use your Firefox login, use the CPU encoder, try again). Rules answer first; your AI model is asked only when none matches, and its answer is labelled.
- **Spoken words**: transcripts of your videos are made on this computer with Whisper (whenever Subtitles runs, or with "Spoken words > Make searchable" on a finished video) and searchable from the Library; a hit opens the trimmer at that moment. With a model chosen in Settings > AI you can also summarize a video, get chapters (written into a copy without re-encoding, or copied as a YouTube list) and ask it questions, with answers that cite the time. See `docs/AI.md`.
- **Colour Grade** (new tool): fixes washed-out, dark or tinted footage by itself (it measures the picture and says why it changed each setting), applies one of six built-in looks (warm film, teal and orange, bleach bypass, rich black and white, vintage fade, cool night) at any strength, takes your own .cube LUT files, can give a video the colours of a reference picture, and has sliders for warmth, tint, exposure, contrast and saturation, with a live before and after. Looks you like can be saved, and Settings > AI can suggest one from a description such as "a warm 70s film". HDR videos are tone-mapped to SDR first. Also in the terminal app and the MCP server.
- **Chat** (new page, in the top bar and the command palette): talk to the assistant with streaming answers, a collapsed "Thinking…" block, the look-ups it made, and Markdown. It proposes jobs as cards with the tool's settings; nothing starts until you press Run, and each started job shows its progress right in the conversation (tagged "via AI" in the Library). Attach files with the button. Conversations are kept on this computer (switch off in Settings > AI, delete one or all any time).
- **AI runtime** (first part, Settings > AI, off by default): choose which model answers: Ollama or LM Studio on this computer (detected automatically), another computer over Tailscale or any OpenAI-compatible address, or a cloud API with your own key (Anthropic, OpenAI, Google Gemini, Mistral, xAI, DeepSeek, OpenRouter, Groq or a custom address). Effort, thinking, picture access and temperature are settings. API keys are kept under your system keyring when there is one and never leave except to their own provider. Under it sits a tool bridge: a model can look up jobs and files and can only *propose* jobs from the same definitions the MCP server uses, which you confirm; it can only touch files you picked or that are in the Library, and gets 10 tool calls per request. The chat page, the assistant, the bundled local model download and the other AI features come next.
- **Beat Finder** (new tool): finds the tempo (BPM), the beat times and the musical key of a song (with the DJ wheel notation, like 8A), draws the waveform with a line on every beat, lets you tap the tempo when it guesses half or double, and can write BPM and key tags into a copy (MP3, FLAC, Ogg, Opus) or save the beats as a CSV or chapter file. It can also cut a video to the beat: pick clips or a folder, switch clip every 1, 2, 4 or 8 beats, shuffle them, and the song becomes the sound. Needs a one-click add-on (librosa, about 250 MB, no PyTorch). Also in the terminal app (analysis) and the MCP server.
- **Restore** (new tool): clean up old or shaky footage in one pass: deinterlace (only when the video really is interlaced), denoise (light, medium or strong), stabilize and fix faded colors, with a before and after slider to try the settings on one frame. It can then hand the result to the AI upscaler and the frame interpolator as follow-up jobs in the same Library group. Also in the terminal app, the MCP server and as a recipe step.
- **Smart scheduling** (Settings, off by default): only start heavy jobs inside a time window (for example 23:00 to 07:00), hold them while on battery, pause the running GPU job when it gets too hot and continue it 8 degrees cooler, start them only after you have been away for a while, and choose what happens when the queue finishes (nothing, a notification, sleep or shut down with a 60 second cancelable countdown, after you confirm once). A held job says why in the Library, for example "Waiting for 23:00" or "Cooling down (86 °C)". The terminal app applies the same rules but never sleeps or shuts the computer down by itself.
- **Jump Cut** (new tool): for talking videos and podcasts. Removes the silences in one pass (you set the silence level, the shortest silence to cut and how much to keep around each cut, and can see how much would go before encoding) and/or evens out the loudness to the podcast (-14 LUFS) or broadcast (-23 LUFS) standard with a two-pass measurement. Can write just an MP3. Also in the terminal app, the MCP server and as a recipe step.
- **Settings > Servers:** add an OPNduck server by pasting its pair link (access token kept in the system keyring when there is one), see whether it is online, which GPU it has and how much disk is free, get a warning for unencrypted network connections, and choose per kind of job where it runs by default. A new **Share this PC's engine** switch lets another OPNduck or the phone app pair with this computer (QR code, one-time link, a list of paired devices you can remove). The "Run on" switch on each tool card comes next.
- **Android companion app** (first version, `companion/`): pair by scanning a QR code or pasting a link, send links (also from the Share menu of any app) with a format choice, watch the queue, and download finished files to the phone with one tap into Downloads/OPNduck. Built with Capacitor; the device token is kept under an Android Keystore key; no Google services. Not released yet: notifications and the signed release build come next. Also: notifications when a job is ready, a phone-friendly copy option, the OPNduck duck as its icon, and a release workflow with F-Droid metadata. See `docs/COMPANION.md`.
- **Run on menu** in every tool card header (once a server is paired): choose this PC or a server for that tool, or follow the default from Settings > Servers. New guide: `docs/SERVER.md`.
- **Jobs on a server:** a job set to run on a server (by the per-kind choice in Settings > Servers) shows up in the queue and Library as one task tagged "on <server>": it uploads the file, runs there, downloads the result into your folder and tidies up the server. Cancel and Run again work, a dropped connection resumes, and the status says what it is doing (Uploading, Running on…, Downloading result, Reconnecting). Only the settings a server knows leave your computer, never folders or paths.
- **OPNduck Server** (new, `server/`): the engine without a window for a home server, NAS or container (`opnduck-server`, Docker images `:latest` and `:full`, a compose file with NVIDIA, AMD/Intel and Tailscale-sidecar setups, a systemd unit). Devices pair with a one-time code (`opnduck-server pair` prints a link and QR code), upload files in resumable chunks, start jobs on them, follow progress live and download the results with resume. Other devices never send file paths: a job takes an upload id and results go to the server's own folder. Per-device tokens are stored only as hashes and can be revoked; pairing and failed sign-ins are rate limited; uploads and results are deleted after 48 hours by default. The desktop app's own controls for using a server come next.
- **Recipes in the terminal app and the watch folder:** the terminal app has a Recipes screen (enter runs the selected recipe on a link or file you type). The Settings watch folder can run a recipe on new files instead of just converting them; files the recipe cannot take are skipped and results go to a `recipe-results` subfolder.
- **Recipes**: chain tools into one saved flow, for example download as MP3 then tag it, or upscale 2× then smooth the motion. Each step's result goes to the next step; the editor only offers steps that can take what the last one makes (it refuses subtitles → upscale and the like); drag steps to reorder them; run a recipe on files, a whole folder or a link. The steps of a run show up as one group in the Library, the files made by the middle steps are deleted at the end (unless you keep them), and if a step fails the rest are listed as skipped. Four built-in recipes ship with it (read-only, duplicate to change). MCP has `list_recipes` and `run_recipe`.
- **Music Tagger, part 2:** a **Fix tags** button on finished audio rows in the Library opens that song in the Music Tagger. A new Settings option, **Tag new audio downloads automatically** (off by default, because it uses the internet), tags MP3 and FLAC downloads when they finish if the match is at least 90% sure. For Spotify-link downloads the Spotify artist and title are used when the fingerprint finds nothing.
- **Community files** for the GitHub project: code of conduct, contributing guide, security policy (private vulnerability reporting), bug and feature issue forms, a pull request template and an accessibility statement.
- **Auto settings**: an **Auto** button on the video and image upscalers, frame interpolation, subtitles and compress cards. It looks at the first file you chose (size, frame rate and whether it varies, codec, HDR, interlacing, black bars, loudness, and whether it looks like animation or filmed video) and sets the options for it, then **Why these settings?** shows the reason for every choice and warns about things like HDR, interlaced video, or a video that is already smooth. It is plain rules, not an AI model, and nothing leaves your computer. Over MCP it is the read-only `suggest_settings` tool.
- **GIF & Stickers** (new tool): turn a section of a video into a GIF (one palette pass, so the colours stay clean), an animated WebP, a Telegram video sticker (WebM, up to 512 px, 3 seconds, 256 KB) or a Discord sticker (APNG, up to 320 px, 512 KB). If a sticker comes out over its limit, OPNduck lowers the frame rate, then the size, then the quality and tries again, and says so. Pick the part by typing times or with the visual trimmer; the trimmer also has a "Make a GIF or sticker of this part" button. Also in the TUI and over MCP (`make_gif`).
- **Music Tagger** (new tool): fills in artist, title, album, year, track number and cover art for MP3, FLAC, M4A, Ogg and Opus files. Pick songs or a folder, press Look up, and a table shows what each file has now, what was found and how sure it is; matches above 90% are ticked for you, and nothing is written until you press Write tags. It can also move files into Artist/Album/ folders (off by default, never overwrites). Songs are recognised by an audio fingerprint (Chromaprint's `fpcalc`, which you install yourself: `sudo pacman -S chromaprint` on Arch) looked up on AcoustID, then MusicBrainz and the Cover Art Archive. **Privacy:** the only data sent is each song's fingerprint and title, only when you press Look up; no account, no key of yours. Also in the TUI and over MCP (`tag_music`, which writes only above its confidence limit). The original file is replaced only after the tagged copy is checked.
- **Compress** (new tool): make a video or audio file land just under a size, like 20 MB for Discord, 16 MB for WhatsApp or 25 MB for email. It works out the bitrate that fills the size, lowers the resolution (and, if still needed, the frame rate) only as far as the picture needs, and encodes with the GPU (Fast) or in two x264 passes (Best quality). If the target can't be reached it says the smallest size it can. Also available in the TUI and over MCP (`compress`).
- **Plugin system** (beta): plugins can add a card to Home and/or a background script that starts jobs, reads files, uses the network and adds tools, each behind permissions you approve. New Plugins page (Installed tab) to review permissions, turn plugins on and off, remove them and open the plugins folder, plus a Safe mode switch that skips every plugin. Plugins that are not verified show a warning first. Permissions are not a sandbox; see `PLUGINS.md`. Tools a plugin adds show up for MCP clients (as `<plugin>__<tool>`) and on the TUI home screen, where they open a form and show the result. Plugins are approved in the desktop app; the TUI only runs the ones already approved there. Plugin cards run in a sandboxed frame: a card cannot reach the app's window or bridge, has no network of its own, and talks to the host only through a message bridge that applies the plugin's permissions. A plugin can also fill part of Home (`ui.slot: "selector"` or `"stage"`); the **Tool Wheel** example puts a slowly turning wheel of tool cards under the tiles that spins to the one you pick, with the real tool in the middle. After an audit, the plugin host now serialises start/stop races, cancels a plugin's jobs when it is switched off, refuses writes through symlinks, rejects ids that clash with built-in JavaScript names and checks store redirects before following them. The `exec` permission is now described as nearly as powerful as running any program and starts unticked. The **Store** tab lists Verified and Community (unverified) plugins from the `opnduck-plugins` index and installs one with a checksum: the archive of a pinned commit is downloaded, its SHA-256 must match the index or it is thrown away, it is unpacked safely (no links, no `..`, size limits) and lands switched off until you review its permissions. Unverified ones ask you to confirm first.

## [0.5.3-Beta] - 2026-10-31

### Added
- **OPNduck TUI** (beta): the tools in a terminal, about 100 MB of memory instead of about 680 MB. Tools, Queue, Library, Settings and Setup screens, forms for all eight tools with path completion, live progress, and all 26 themes. It shares settings and history with the desktop app. Run it with `npm run tui`, or unpack the new `opnduck-tui` tarball (needs Node.js 20 or newer). See `docs/TUI.md`. It is also packed as an npm package (`npm run tui:npm`) for the npm registry and GitHub Packages.
- **Setup wizard**: on first launch (and from Settings, System, Open setup) a window lists the downloader, the fast video engine, Audio AI and Subtitles with their download sizes, marks what you already have, and installs the ones you tick one after another with live progress and a Cancel button. Tools that come from your package manager (ffmpeg, Real-ESRGAN, RIFE, LibreOffice) are listed with their install command when missing.

### Changed
- Internal: the job code (downloads, conversion, trimming, upscaling, interpolation, subtitles, AI audio, the task queue and tool detection) now lives in Electron-free `electron/core/` modules, in preparation for a lightweight terminal version. The app behaves the same.
- The developer-tool channels in the desktop shell now refuse to run unless Developer mode is on. This is a guard inside the app, not a security boundary.
- Switching back to Blarange or Monochrome clears the cached theme colours the startup screen uses.

## [0.5.2-Beta] - 2026-10-31

A visual and tidying release. Home is a compact grid of tool tiles, there is a themed startup screen, corners are sharper and the wording is plainer. The Tauri migration is still **postponed** (WebKitGTK on Linux stutters/crashes with NVIDIA + Wayland); OPNduck stays on Electron.

### Added
- **New startup screen**: a duck bobbing on moving waves with the wordmark hopping in, all in the colours of your chosen theme (including Omarchy and palette themes), replacing the old fixed orange gradient bar.
- **Pixel look**: a blocky pixel wordmark in the top bar and on Home, and a faint scatter of pixels along the top of every page, both in the current theme's accent.
- **More developer tools** (Settings, with dev mode on): IPC trace (channel and timing, slow calls highlighted), main-process event-loop lag, saved-settings viewer (redacted), raw job launcher, sample video/audio/image generator, and layout outlines.

### Changed
- **Home is less crowded**: a compact tile for each tool, and only the tool you pick opens below. The open tool is in the URL (`?tool=`), so the command palette now jumps straight to it.
- **Calmer Blarange colours**: neutral warm-black surfaces and borders instead of orange-tinted ones, orange kept for actions, focus and the active item, and a flat wordmark instead of the gradient with a glow. The Beta notice now follows the theme.
- **Sharper corners**: the radius scale is now 1-4 px in Blarange and Monochrome (Omarchy themes were already square).
- **Plainer wording and less filler** across the app: Home is a short "Tools" page, tool cards no longer carry a Desktop/Universal badge, shorter Settings and theme text, a clearer Download button, and the Settings category panel no longer overlaps the page.
- **Readable text and icons in every Omarchy palette**: dim text and the menu icons are now derived from the main text colour (the palettes' own "dark foreground" was almost invisible on themes like Nord), and the pixel logo shades toward the text colour so it also works on light themes.

### Performance
- Engine checks (PyTorch, Demucs, Whisper) are remembered between launches and re-checked in the background, so the cards no longer wait about 2.5 s for a Python start. `nvidia-smi` is asked once per session instead of on every check.

## [0.5.1-Beta] - 2026-10-31

### Added
- **A secret for the curious**: something hides behind the OPNduck name. Once found, Settings gains a switch to keep it in the menu.
- **Animated menu icons**: Settings spins, Plugins pulls back and plugs in with a spark, Library pulls a book out, Home hops. They play on hover/press and are off with reduced motion.
- **MCP server** (Settings → System, off by default): any MCP-capable AI app (Claude Code, Codex, Gemini CLI, Cursor, Claude Desktop, LM Studio, ...) can start downloads, conversions, upscales, interpolation, subtitles, trims and audio AI, watch jobs and their logs, cancel jobs and pause the queue. Localhost only, token-protected, saves only to your download folder, jobs are tagged "via MCP". See `docs/MCP.md`.

## [0.5.0-Beta] - 2026-10-31

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
- Readable text and icons in every Omarchy palette: dim text and the menu icons are now derived from the main text colour (the palettes' own "dark foreground" was almost invisible on themes like Nord), and the pixel logo shades toward the text colour so it also works on light themes.
- Pixel look: a blocky pixel wordmark in the top bar and on Home, and a faint scatter of pixels along the top of every page, both in the current theme's accent.
- Sharper corners: the radius scale is now 1-4 px in Blarange and Monochrome (Omarchy themes were already square).
- Calmer Blarange colours: neutral warm-black surfaces and borders instead of orange-tinted ones, orange kept for actions, focus and the active item, and a flat wordmark instead of the gradient with a glow. The Beta notice now follows the theme.
- Plainer wording and less filler across the app: Home is a short "Tools" page, tool cards no longer carry a Desktop/Universal badge, shorter Settings and theme text, a clearer Download button, and the Settings category panel no longer overlaps the page.


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

## [0.4.0-Beta] - 2026-10-18

First Beta. The Tauri migration is still **postponed** (WebKitGTK on Linux stutters/crashes with
NVIDIA + Wayland); OPNduck stays on Electron.

### Added

- **Subtitles card** wired to faster-whisper (uses your own Python 3 with `faster-whisper`
  installed; set `OPNDUCK_PYTHON` to point at a venv).
- **Background setting** (Settings → Appearance): **Flat** is now the default; **Gradient**
  restores the theme's fade. In flat mode cards are lifted slightly so they never blend
  into the page.
- **Update check** (notify-only): on launch OPNduck asks GitHub whether a newer release
  exists and offers Download / Later / Skip this version; Settings → System → Updates has an
  on/off switch and Check now. Nothing is installed automatically.
- Windows smoke-test GitHub workflow (`windows-smoke.yml`).

- **Downloader power-ups:** 8K (4320p) and 1440p quality; subtitles (uploaded or auto-generated, any
  language the video offers, saved as .srt, optionally embedded, or subtitles-only); dubbed/multi-language
  audio tracks saved as separate MP3 files; 360°/3D tags; whole channels, search results, Watch Later and
  Liked lists with a "first N" choice; a proxy setting (Settings → Downloads); and **Smart mode**, which
  remembers your choices for every new download (card and command palette).

- **Sign-in for private content** (Settings → Downloads): use your browser's login (Firefox, Chromium,
  Chrome, Edge, Brave, Opera, Vivaldi, with an optional profile), a `cookies.txt` file, or OPNduck's own
  sign-in window (separate session; only cookies are saved, in a private file, deleted by Sign out).
  Unlocks Watch Later, Liked videos, private playlists and age-restricted media. Includes a Test sign-in
  button.

- **Library management:** search, filter by type and status, and sort (newest, oldest, name, size,
  status); batches (several files started together, or a download plus its audio tracks) show as one
  collapsible group with Cancel all and Retry failed; remove single entries; **Export** the history to a
  JSON file and **Import** it back (add to history, or add and run again) — imports are re-validated,
  so a hand-edited file can't smuggle in anything the app wouldn't accept. History now keeps 500 entries.

- **Subscriptions** (Library → Subscriptions, or "Subscribe to new uploads" on a channel/playlist link in
  the Downloader): new uploads download automatically. Checked shortly after launch and then hourly
  while OPNduck is open; only future uploads by default (optionally the latest 3/5/10 too); a failed
  download is retried on the next check (up to 3 times per session); desktop notification when something new starts.

- **AI Audio card** (Demucs): remove vocals (instrumental), extract vocals / remove background music,
  isolate a voice (vocals + speech cleanup), and a basic ffmpeg echo & noise reduction mode. Works on
  audio or video files (optionally putting the processed audio back on the video), outputs MP3/FLAC/WAV.
  Needs Python with `torch`, `demucs` and `soundfile` (a venv at `~/.opnduck-venv` is found automatically, or set `OPNDUCK_PYTHON`); the card
  shows the install command when it's missing.

### Changed
- Readable text and icons in every Omarchy palette: dim text and the menu icons are now derived from the main text colour (the palettes' own "dark foreground" was almost invisible on themes like Nord), and the pixel logo shades toward the text colour so it also works on light themes.
- Pixel look: a blocky pixel wordmark in the top bar and on Home, and a faint scatter of pixels along the top of every page, both in the current theme's accent.
- Sharper corners: the radius scale is now 1-4 px in Blarange and Monochrome (Omarchy themes were already square).
- Calmer Blarange colours: neutral warm-black surfaces and borders instead of orange-tinted ones, orange kept for actions, focus and the active item, and a flat wordmark instead of the gradient with a glow. The Beta notice now follows the theme.
- Plainer wording and less filler across the app: Home is a short "Tools" page, tool cards no longer carry a Desktop/Universal badge, shorter Settings and theme text, a clearer Download button, and the Settings category panel no longer overlaps the page.


- Job queues: downloads run 3 at a time, conversions 2, GPU jobs (upscale, interpolation, AI audio) 1;
  the rest wait in line.
- Output files never overwrite each other: names are reserved when a job is queued, so batch items
  with the same file name get a numbered suffix.
- Many hardening fixes from the pre-beta audits: stricter validation of imports, settings and
  sign-in windows, safer folder opening, subscription retry limits, and MP4-safe video output for
  AI Audio.
- Command palette default shortcut is now **Ctrl+K** (existing rebinds are untouched).
- Dependency refresh (Electron, framer-motion, oxlint).

### Performance

- Removed the per-card `backdrop-filter` (a no-op blur that cost a compositing layer on every
  card), the six animated blurred background blobs (invisible but still drawn every frame) and
  the whole-page blur animation on page switches. Measured on the packaged UI: idle ~103 → ~200
  fps, scrolling ~97 → ~199 fps, page switching ~60 → ~160 fps.
- Job-progress updates are coalesced (max one per 120 ms) so a running upscale no longer
  re-renders every card dozens of times a second.
- Removed unused theme tokens, dead code and a leftover platform helper.

### Fixed

- Keyboard shortcuts with Ctrl no longer miss letters/Space on input methods and non-US
  layouts (shortcuts read the physical key).
- Windows: LibreOffice is found outside PATH; yt-dlp output is forced to UTF-8.

### Known issues

- Windows installers are built from Linux via wine and are still untested on real Windows.
- AI Audio: real-music separation quality has only been checked on speech. The Demucs install is
  large (about 5.5 GB including the CUDA libraries).
- Signing in inside the built-in window may be refused by Google; use browser cookies instead.
- A Library with a very large history is not virtualized; task updates still include history;
  stale temp folders are not swept at startup; the Smart download panel has no "first N" limit
  for channels.
- No AUR publication and no artifact signing yet (deferred).

## [0.3.2-Alpha] - 2026-10-10

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

## [0.3.1-Alpha] - 2026-10-10

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
- Readable text and icons in every Omarchy palette: dim text and the menu icons are now derived from the main text colour (the palettes' own "dark foreground" was almost invisible on themes like Nord), and the pixel logo shades toward the text colour so it also works on light themes.
- Pixel look: a blocky pixel wordmark in the top bar and on Home, and a faint scatter of pixels along the top of every page, both in the current theme's accent.
- Sharper corners: the radius scale is now 1-4 px in Blarange and Monochrome (Omarchy themes were already square).
- Calmer Blarange colours: neutral warm-black surfaces and borders instead of orange-tinted ones, orange kept for actions, focus and the active item, and a flat wordmark instead of the gradient with a glow. The Beta notice now follows the theme.
- Plainer wording and less filler across the app: Home is a short "Tools" page, tool cards no longer carry a Desktop/Universal badge, shorter Settings and theme text, a clearer Download button, and the Settings category panel no longer overlaps the page.


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

## [0.3.0-Alpha] - 2026-10-10

> **Known broken:** installed builds of this version open a blank window.
> Use 0.3.1-Alpha instead.

Largest feature release since 0.2.0: a rebuilt multi-format Converter, YouTube
playlist downloads, AI upscaling/interpolation cards, a lot of UI polish, a
dependency security pass and an audit-hardening pass.

### Tauri migration: POSTPONED

The Tauri v2 migration was fully built (Rust backend, ported pipelines,
vendored Windows sidecars) and is archived on the `tauri-migration-phase1`
branch, but it is **postponed and not shipping**. Tauri uses WebKitGTK on
Linux, which stutters/lags and can segfault with hardware compositing on the
NVIDIA proprietary driver under Wayland (an upstream platform bug, not an
OPNduck bug). OPNduck stays on **Electron** until that is fixed upstream; it
may be revisited for Windows (WebView2) or non-NVIDIA Linux.

### Added

- **Multi-format Converter** (rebuilt): video/audio/image via ffmpeg and
  documents (PDF, DOCX, ODT, RTF, TXT, HTML) via LibreOffice, with a big
  format-picker window, a supported-formats panel and per-tool gating when
  ffmpeg or LibreOffice is missing.
- **YouTube playlist downloading** in the Downloader; Run Task is blocked
  until the link check finishes and the playlist is probed in parallel.
- AI Image Upscaler, AI Video Upscaler (multi-file queue) and AI frame
  interpolation (RIFE) cards, plus rebindable keybinds.
- Hidden "Synced with Omarchy" theme with square corners.
- Real SVG icons instead of emoji/text glyphs.

### Changed
- Readable text and icons in every Omarchy palette: dim text and the menu icons are now derived from the main text colour (the palettes' own "dark foreground" was almost invisible on themes like Nord), and the pixel logo shades toward the text colour so it also works on light themes.
- Pixel look: a blocky pixel wordmark in the top bar and on Home, and a faint scatter of pixels along the top of every page, both in the current theme's accent.
- Sharper corners: the radius scale is now 1-4 px in Blarange and Monochrome (Omarchy themes were already square).
- Calmer Blarange colours: neutral warm-black surfaces and borders instead of orange-tinted ones, orange kept for actions, focus and the active item, and a flat wordmark instead of the gradient with a glow. The Beta notice now follows the theme.
- Plainer wording and less filler across the app: Home is a short "Tools" page, tool cards no longer carry a Desktop/Universal badge, shorter Settings and theme text, a clearer Download button, and the Settings category panel no longer overlaps the page.


- Motion & Density settings now apply app-wide.
- Home grid lays out with equal-height rows and no gaps.
- Dropdowns are portaled and no longer render underneath neighbouring cards.
- Electron 44.1 to 44.7, React/React DOM 19.3, TypeScript 7.0, framer-motion
  14.1, Vite 8.3, plus minor bumps (react-router-dom, Tabler icons, oxlint,
  wait-on, React types). `@types/node` 26 (Electron 44 bundles Node 24, so
  types are slightly ahead of the runtime).

### Fixed / Security

- yt-dlp option-injection fix (hardened spawning); cancel, preview and picker races.
- Better error messages, ffmpeg stream mapping and theme fallback.
- **Dependency advisories cleared.** `concurrently` 10.0.6 pulls the patched
  `shell-quote` (critical command injection); `npm audit fix` patched
  `brace-expansion`, `http-cache-semantics`, `joi`, `source-map-js`, `undici`
  and `fast-uri`. The only remaining advisory is a dev-only moderate chain
  under `electron-builder` (`sprintf-js` via `roarr`/`global-agent`); the sole
  offered fix downgrades `electron-builder`, so it is left until upstream fixes it.

### Known issues

- Batch conversions start all jobs at once (no concurrency cap).
- Video upscale/interpolate output extension follows the input container.
- Cancelling a LibreOffice job may leave a `soffice.bin` orphan process.
- No URL scheme allow-list or IPC input validation (low exposure; the window is sandboxed).
- No Content-Security-Policy.
- GlassSelect has no keyboard navigation.
- Linux packaging is only built where possible; no Windows/AUR publication in this release.

## [0.2.1-Alpha] - 2026-09-20

Critical packaging bug: the app was effectively unusable once actually
installed (as opposed to run from the dev server) — reported after
installing v0.2.0-Alpha fresh on a Windows machine.

### Fixed

- **Navigation completely broken in the packaged app.** `App.tsx` used
  React Router's `BrowserRouter`, which needs a real HTTP server to resolve
  URL paths. The packaged app loads `index.html` straight off disk via
  `file://` — no server at all — so no route ever matched: no cards
  rendered on any page, and clicking a nav link did nothing. Switched to
  `HashRouter`, which is pure client-side routing and needs no server, so
  it works identically in the Vite dev server, the browser preview, and the
  packaged `file://` app.
- **Social icons missing in the packaged app.** The social-link icons in
  `src/lib/nav.ts` were referenced by hardcoded absolute paths
  (`/icons/x.png`), which resolve against a real server's root in dev but
  resolve to the OS filesystem root under `file://` (e.g. `C:\icons\x.png`
  on Windows) — a 404. Now built from Vite's `BASE_URL`, correct in both
  environments.
- Neither bug was ever visible during development because this project's
  entire test cycle up to this point ran against the Vite dev server
  (`http://localhost:1420`), never the actual packaged build. Added
  renderer console forwarding to the Electron main process
  (`electron/main.cjs`) so a packaged app's JS errors are no longer
  silently invisible with nowhere to look — exactly how this shipped
  unnoticed in the first place.

## [0.2.0-Alpha] - 2026-09-20

First release with a real, working feature: the Downloader now drives an
actual `yt-dlp` process on the system PATH instead of being a UI stub. Per
the project's own versioning rule, this is what moves OPNduck out of
Pre-Alpha.

### Added

- Real media downloading via `yt-dlp` (system PATH, not bundled), wired
  through a new `Host.tasks` interface — the same seam the eventual Tauri
  adapter will implement.
- Full download queue: multiple concurrent downloads, per-item cancel, live
  progress, shown both inline on the Downloader card and on the Downloads
  page.
- Video quality (Best/2160p/1080p/720p/480p/360p) and MP3 bitrate
  (Best/320k/192k/128k) selection, plus an approximate file-size preview
  before starting a download, all via a `yt-dlp --dump-json` probe.
- Video/audio thumbnails on the Downloader card and Downloads queue.
- Format/quality/size metadata shown as small tag chips.
- A default-download-folder setting (Settings > Storage & Performance),
  with a real native folder picker.
- A plain-language install-command banner on the Downloader card when
  `yt-dlp` isn't found on PATH.

### Fixed

- Per-feature card accent glow bled a fixed warm color into the Monochrome
  theme instead of staying neutral.
- Settings category-rail scrollspy jumped to the wrong (next) category when
  clicking a short section like Keybinds.
- Page-slide transition had degraded to a fade-only animation — a shared
  "settled" flag governing a post-animation `transform: none` reset was
  stale on the very first frame of every navigation.
- Top bar could overflow past the window edge and clip content unpredictably
  at ordinary window widths; nav labels now collapse to icon-only below the
  `xl` breakpoint, and the header now has a hard `overflow-hidden` backstop.
- Hamburger menu's dropdown was being clipped by an ancestor's
  `overflow-hidden` — portaled to `document.body` instead, same fix already
  used for the Settings rail.
- Window minimum size could be ignored by the compositor on some
  Linux/Wayland setups (a known Electron limitation for frameless windows);
  now force-clamped in the main process.
- Scrollbars removed entirely, app-wide, instead of chasing further
  per-theme scrollbar-color inconsistencies.

## [0.2.0-Pre-Alpha] - 2026-09-02

First tagged release. Full rewrite of the frontend shell on the new "Liquid
Glass" design system — GUI, routing, theming, settings, and the adaptive
card dashboard. Download/convert/AI engines are not wired in yet (Alpha
phase).

### Changed
- Readable text and icons in every Omarchy palette: dim text and the menu icons are now derived from the main text colour (the palettes' own "dark foreground" was almost invisible on themes like Nord), and the pixel logo shades toward the text colour so it also works on light themes.
- Pixel look: a blocky pixel wordmark in the top bar and on Home, and a faint scatter of pixels along the top of every page, both in the current theme's accent.
- Sharper corners: the radius scale is now 1-4 px in Blarange and Monochrome (Omarchy themes were already square).
- Calmer Blarange colours: neutral warm-black surfaces and borders instead of orange-tinted ones, orange kept for actions, focus and the active item, and a flat wordmark instead of the gradient with a glow. The Beta notice now follows the theme.
- Plainer wording and less filler across the app: Home is a short "Tools" page, tool cards no longer carry a Desktop/Universal badge, shorter Settings and theme text, a clearer Download button, and the Settings category panel no longer overlaps the page.


- Removed the Flat theme entirely — the theme engine now ships with two
  modes, **Glass** and **Monochrome**, instead of three.
- Removed several AI-generated-UI design clichés identified in an explicit
  design audit: all-caps labels, middle-dot separators, and identical
  nested cards (converted to divider-lists).
- The card hover-lift/glow effect is now toggleable via the existing
  Reduce Motion setting.
- General code simplification and cleanup: removed a shadowed function
  parameter and deduped repeated styling (GlassTune, StorageCard).

### Fixed

- Multi-layered CSS containing-block bug on the Settings page — the
  category rail now correctly follows scroll, implemented via a React
  portal.
- GlassTune dev-tool theme-leak bug where Glass-only colors bled into
  other themes.
- Assorted Settings layout/scroll issues fixed and re-verified during this
  pass (sticky/fixed rail behavior, hamburger dropdown opacity, banner
  placement, page-transition flash).

### Added

- Hover highlight on Settings interactive controls.
- Dev/debug mode (keybind-gated) with a runtime backdrop-tuning panel
  (GlassTune).

### Verification

- `tsc -b` (typecheck), `vite build` (production build), and `oxlint`
  were run clean at each step of this pass, with a final code-audit
  checkpoint commit confirming no regressions.

---

Full commit-level detail: see
[`github-release/opnduck/v0.2.0-Pre-Alpha/CHANGELOG.raw.md`](./github-release/opnduck/v0.2.0-Pre-Alpha/CHANGELOG.raw.md)
for the unabridged git-cliff output.
