# OPNduck quick facts

Short, checked answers about what OPNduck does, its limits and its defaults. The assistant searches this file (and the other
docs) when you ask how something works.

## Spotify links (experimental YouTube match)

OPNduck cannot download from Spotify itself, because Spotify's tracks are DRM-protected. As an experimental feature it reads a
single track link (open.spotify.com/track/...), identifies the song, and downloads a matching YouTube video as MP3. The result
is labelled as a match, not as a Spotify download, and the audio quality is YouTube's. Pasting a Spotify track link switches
the format to MP3. Album, playlist, artist, show and episode links are not supported yet. If the match is wrong, press Run again
on the job: OPNduck asks, then picks a different YouTube video (premieres are skipped). Only open.spotify.com is contacted to
identify the track.

## Downloader

Downloads video or audio with yt-dlp from YouTube, TikTok, SoundCloud and similar links, and Spotify track links through the
YouTube match. Formats: MP4, MP3, MKV, MOV, FLAC, WAV. Video quality: best, 2160, 1440, 1080, 720, 480 or 360. Audio quality:
best, 320k, 192k or 128k. By default 3 downloads run at the same time (setting maxDownloads). yt-dlp can be downloaded and
updated from inside OPNduck in Settings > Downloads (checksum-verified, no admin rights needed).

## Converter (convert)

Converts media, images and documents. Containers: MP4, MKV, WEBM, MOV, AVI, GIF, MP3, FLAC, WAV, OGG, M4A, OPUS, PDF, DOCX,
ODT, RTF, TXT, HTML, PNG, JPG, WEBP, AVIF, BMP, TIFF, ICO. Mode "remux" only rewraps the file in a new container without
re-encoding; "transcode" re-encodes. By default 2 conversions run at the same time (setting maxConversions).

## Compressor (compress)

Makes a video or audio file land just under a size you choose, for example 10 MB for Discord. You give the target size in MB
and a quality (fast or best).

## Trimmer (trim)

Cuts a section out of a video or audio file with a start and end time. Mode "fast" cuts without re-encoding; "precise" cuts at
the exact frame. OPNduck has no tool that automatically trims a video to the length of a song: give the start and end times, or
use beat_cut to make a montage on the beat.

## Image and video upscaler (upscale_image, upscale_video)

Uses Real-ESRGAN at 2x, 3x or 4x with the models realesr-animevideov3, realesrgan-x4plus or realesrgan-x4plus-anime. Video
upscaling runs on the GPU and is slow for long videos. The video engine setting is "auto" by default: PyTorch when it can run
(faster, streams frames), otherwise ncnn.

## Frame interpolation (interpolate)

Raises a video's frame rate with RIFE, 2x or 4x (for example 24 fps to 60 fps).

## Subtitles (subtitles)

Generates subtitles with Whisper on this computer. Models: tiny, base, small, medium. You can set the language, translate, and
choose SRT or VTT. Transcripts of your videos are stored under the app's data folder and can be searched in the Library
("Spoken words").

## GIFs, WebP and stickers (make_gif)

Turns a section of a video into a GIF, an animated WebP, or a Telegram or Discord sticker. Presets: gif, webp, telegram,
discord. Sticker sizes and lengths are fitted to the Telegram and Discord limits. You can set start, end, width, fps and loop.

## Background remover (remove_background)

Cuts the person or object out of a picture or video with no green screen. Output: transparent (PNG, WebM or ProRes), a flat
colour, a blurred copy, or another picture behind it. Needs the Background Remover add-on.

## Dubbing (dub_video)

Makes a video speak another language, all on this computer: the voice is split from the music, transcribed, translated, spoken
by a local voice and fitted into the timing, and the picture is not re-encoded. Target languages: en, sv, de, fr, es, it. Needs
the Dubbing add-on.

## Colour grading (grade)

Automatic fixes measured from the picture (levels, brightness, colour cast), a look (warm_film, teal_orange, bleach_bypass,
bw_rich, vintage_fade, cool_night, or an imported look) and sliders for exposure, contrast, saturation, temperature and tint.
The automatic fix, looks and sliders use plain rules, not AI.

## Beat Finder (beat_analyze)

Finds the tempo (BPM), beat times and musical key of a song. It can write BPM and key into a tagged copy (MP3, FLAC, Ogg, Opus).
Needs the Beat Finder install (librosa).

## Beat cutting (beat_cut)

Makes a montage that switches between video clips (or folders of clips) on the beat of a song, every 1, 2, 4 or 8 beats, with
the song as the sound. It does not trim a video to a song's length.

## Restore old footage (restore)

Cleans up old or bad footage in one pass: deinterlace (auto, on, off), denoise (off, light, medium, strong), stabilize and fix
colors. Upscale or interpolate can be added; they run as follow-up jobs in the same group.

## Jump cuts and loudness (jump_cut)

Removes silences from a talking video or podcast with one re-encode, and can even out the loudness. Defaults: silence
threshold -30 dB, minimum silence 0.5 seconds, padding 0.15 seconds, parts closer than 0.3 seconds are merged. Normalize
options: off, podcast (-14 LUFS) or broadcast (-23 LU).

## Music tagger (tag_music)

Looks a song up by its audio fingerprint (AcoustID, MusicBrainz, Cover Art Archive) and writes artist, title, album, year, track
number and cover into the file. It changes the file only when it is sure enough. Automatic tagging of new audio downloads is
off by default (Settings, "Tag new audio downloads automatically"); when on, each song's fingerprint and title are sent to
those services. A "Fix tags" button on finished audio rows in the Library opens that song in the Music Tagger.

## Audio AI (audio_ai)

Removes vocals, isolates the voice or cleans up audio. Modes: no-vocals, vocals, voice, echo. Demucs does the separation;
ffmpeg handles echo. Output formats: MP3, FLAC, WAV.

## Job queue

You can list jobs, see one job's status and log, cancel a job, pause the queue and resume it. Pausing lets running jobs finish
and stops waiting jobs from starting. Jobs started by the assistant are tagged "via AI" in the Library, and jobs started over
MCP are tagged "via MCP".

## Plugin safe mode

Safe mode starts OPNduck with every plugin skipped. It is off by default (setting pluginsSafeMode is false) and applies on the
next start. Turn it on in Settings to find out whether a plugin is breaking startup, then switch plugins on one at a time.

## Smart scheduling for heavy jobs

Everything is off by default. You can limit heavy jobs (conversions, GPU work, transcription) to a time window (default
23:00 to 07:00), hold them while on battery, pause GPU jobs above a temperature (default limit 85 C), or start them only
after you have been away for a while (setting schedule.idle, with schedule.idleMinutes from 1 to 240, default 10). When the
queue is empty OPNduck can do nothing, notify, sleep or shut down; sleep and shutdown stay off until you have confirmed once
in Settings.

## Send to OPNduck and the relay

Send to OPNduck accepts links from other devices; it is off until you turn it on (remote port 47821). While it is on, OPNduck
also listens to an encrypted relay channel (ntfy). If that connection is silent for 120 seconds a watchdog drops it and
reconnects.

## Android app and iPhone

There is an Android companion app: a remote control for OPNduck on your own computer or an OPNduck Server. The work happens
on the computer; the phone sends links, shows the queue and downloads finished files. It is not released yet; build it from
companion/README.md or take the APK from a GitHub release. There is no iPhone app; iPhone users can use the web page for
sending links.

## Terminal app (TUI)

The terminal app uses the same job code as the desktop app. It needs Node.js 20 or newer and installs with npm install -g
opnduck-tui, then starts with opnduck-tui. On Arch, if npm gives EACCES because the global folder is root-owned, run
npm config set prefix ~/.local (and put ~/.local/bin on your PATH) or use npx opnduck-tui. It uses about 100 MB of memory
compared with about 680 MB for the desktop app.

## MCP server

An optional local server so tools like Claude Code can start and watch jobs. It is off by default (setting mcpServer). It
listens on this computer only, and needs a private token. See docs/MCP.md for the details.

## AI assistant defaults

The assistant is off until you choose a model in Settings > AI. Providers: off, OPNduck's own downloadable model, Ollama,
LM Studio, another computer, or a cloud API with your own key. The default memory for the conversation is 16384 tokens. The
local model is ejected after 15 minutes without a question. Internet access for the assistant is off by default; when you
turn it on it searches Wikipedia unless you pick Brave Search, your own SearXNG server or DuckDuckGo. The assistant only
proposes jobs: nothing starts until you press Run.

## Other defaults

Desktop notification when jobs finish in the background: on. Keep running in the system tray when the window is closed: off.
GPU video encoder: auto (NVENC when it works, otherwise x264). Watch folder: off.
