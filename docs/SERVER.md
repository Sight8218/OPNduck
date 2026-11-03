# Running jobs on another machine

OPNduck can run heavy jobs (upscaling, interpolation, subtitles, even downloads) on another computer and bring the
result back. The other machine is either **OPNduck Server** (a headless package, see `server/README.md`) or **another
desktop OPNduck that shares its engine**.

## Pairing

1. On the server: `opnduck-server pair` prints a one-time link and QR code (`opnduck://pair?...`). On a desktop: Settings,
   Servers, turn on **Share this PC's engine**, choose who can connect, press **New pair link**.
2. On your computer: Settings, Servers, paste the link, **Add server**. The code works once and expires after 5 minutes.
3. The server gives your computer its own access token. Only a hash of it is kept on the server, so you can remove a
   device at any time (`opnduck-server devices revoke <id>`, or Remove in the desktop list).

## Using it

- **Settings > Servers** chooses, per kind of job, where it runs by default: this PC, a server, or ask.
- Every tool card has a **Run on** menu (shown once a server is paired) that overrides the default for that tool.
- A job on a server shows up in the queue and Library as one task tagged "on <server>". It uploads the file in chunks,
  runs there, downloads the result into your normal folder, and then removes it from the server. Cancel and Run again
  work, and a dropped connection resumes where it stopped.
- Only the settings the server knows about are sent. Folders and file paths never leave your computer, and the server
  never accepts a path from a device.

## Safety

- Use Tailscale or HTTPS. Plain HTTP over a normal network is not encrypted, and Settings warns about it. Loopback and
  Tailscale addresses are fine (already encrypted).
- Pairing attempts and failed sign-ins are rate limited. Uploads are size limited and refused when the disk is too full.
  Uploads and results are deleted after 48 hours on a server (`OPNDUCK_RETENTION_HOURS`).
- On Linux with a firewall such as ufw, allow the port on the Tailscale interface only, for example
  `sudo ufw allow in on tailscale0 to any port 47821 proto tcp`.

## For developers: Engine API v1

All routes are under `/v1`, JSON, and need `Authorization: Bearer <deviceToken>` except `GET /health` and `POST /pair`.

| Route | What it does |
| --- | --- |
| `GET /health` | `{ ok, name, apiVersion }`, no sign-in |
| `POST /pair` | `{ code, deviceName, deviceKind }` returns `{ deviceId, deviceToken }` |
| `GET /info` | version, job kinds, GPUs, free disk, installed tools |
| `GET /tasks`, `GET /events` | task list; live updates as server-sent events (progress at most 4 times a second) |
| `POST /tasks` | `{ kind, req }`; a file job takes `uploadId` instead of a path; returns `{ id }` |
| `POST /tasks/:id/cancel`, `/rerun`, `DELETE /tasks/:id` | as in the app |
| `POST /uploads`, `PUT /uploads/:id`, `HEAD /uploads/:id` | resumable uploads in chunks of up to 16 MB with `Content-Range` |
| `GET /files/:taskId`, `POST /files/:taskId/link` | the result, with `Range`; a 10-minute signed link for browsers |
| `GET /ai/status`, `GET /ai/models`, `POST /ai/load`, `POST /ai/eject`, `POST /ai/chat/completions` | this computer's AI model (OPNduck's own, Ollama or LM Studio, never a cloud key), in the OpenAI shape with your device token as the key: another OPNduck uses it with "Another computer" and the address `http://<this computer>:47821/v1/ai` |
| `POST /send` | an encrypted link from Send to OPNduck (see `SEND.md`) |
| `GET /devices`, `DELETE /devices/:id` | paired devices (desktop devices only) |

The code is in `engine-api/`; `server/ci-smoke.mjs` is a working client.
