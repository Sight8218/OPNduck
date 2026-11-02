# OPNduck Server

The OPNduck engine without a window. It runs the same jobs as the desktop app (downloads, conversions, upscaling,
interpolation, subtitles, compression, GIFs) on a home server, NAS or gaming PC, and offers them to your paired devices
over the **Engine API v1**. Everything stays on your own machines.

## What it does

- Another device **pairs** with a one-time code, then gets its own token (only a hash is kept here; you can remove a
  device at any time).
- A device **uploads** a file in resumable chunks, starts a job on it, follows the progress live, and **downloads** the
  result (with resume).
- Remote devices never send file paths. A job takes an upload id, results go to this server's output folder.
- **Send to OPNduck** works too: links sent from your phone or browser start downloads here.

## Run it with Docker (recommended)

```sh
cp server/docker-compose.yml compose.yml      # pick the GPU / Tailscale variant inside
docker compose up -d
docker compose logs opnduck                    # the pair link and QR code are printed on the first start
```

Images: `ghcr.io/sight8218/opnduck-server:latest` (FFmpeg, yt-dlp, Real-ESRGAN and RIFE through Vulkan) and `:full`
(adds LibreOffice for document conversion). A Python AI image (PyTorch, Whisper, Demucs) comes later.

GPU access: AMD and Intel with `--device /dev/dri`. NVIDIA with the NVIDIA Container Toolkit and
`NVIDIA_DRIVER_CAPABILITIES=all` (Vulkan and NVENC both need it).

Reach it safely: with the Tailscale sidecar in the compose file nothing is published on the host and only your tailnet
can connect. If you publish the port to your network, use a firewall and treat the pair link like a password.

## Run it without Docker

You need Node 22, FFmpeg and yt-dlp (and the ncnn upscalers if you want upscaling).

```sh
npm install -g opnduck-server        # or build it: npm ci && npm run server:build, then node dist-server/opnduck-server.cjs
opnduck-server
```

Arch: `sudo pacman -S nodejs ffmpeg yt-dlp`. Debian/Ubuntu: `sudo apt install nodejs ffmpeg` (Node 22 from NodeSource,
yt-dlp from its GitHub release). To keep it running, copy `opnduck-server.service` to `~/.config/systemd/user/` and
follow the comments inside.

## Commands

```
opnduck-server                    start
opnduck-server pair               a new one-time pair link and QR code (valid 5 minutes)
opnduck-server devices            list paired devices
opnduck-server devices revoke ID  remove a device
opnduck-server send-link          the Send to OPNduck link (phone page, browser extension)
```

In a container: `docker compose exec opnduck opnduck-server pair`.

## Settings

Environment variables, or `config.json` in the data folder (a variable wins).

| Variable | Default | |
| --- | --- | --- |
| `OPNDUCK_DATA` | `/data` in a container, else `~/.local/share/opnduck-server` | settings, devices, uploads |
| `OPNDUCK_OUTPUT` | `<data>/output` | results are saved in `OPNduck/` inside it |
| `OPNDUCK_PORT` | `47821` | |
| `OPNDUCK_BIND` | `127.0.0.1` (`0.0.0.0` in the image) | `127.0.0.1`, a Tailscale address or `0.0.0.0` |
| `OPNDUCK_PUBLIC_URL` | (derived) | the address devices should use, for example `http://192.168.1.50:47821` |
| `OPNDUCK_NAME` | the machine's name | what devices show |
| `OPNDUCK_MAX_UPLOAD_GB` | `8` | |
| `OPNDUCK_RETENTION_HOURS` | `48` | uploads and results older than this are deleted |
| `OPNDUCK_RELAY` | off | `1` to also receive Send to OPNduck links through the ntfy relay |
| `OPNDUCK_UPDATE_YTDLP` | `1` | the image updates yt-dlp when it starts |

## Safety

- Plain HTTP is only for loopback and Tailscale (`100.64.0.0/10`) addresses, which are already encrypted. For anything
  else put it behind HTTPS (a reverse proxy, or Tailscale).
- Pairing and failed sign-ins are rate limited. Uploads are size limited and refused when the disk is too full.
- Plugins are always off on the server.
