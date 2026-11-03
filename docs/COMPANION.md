# OPNduck for Android (companion app)

A remote control for OPNduck on your own computer or on an OPNduck Server. All the work happens there; the phone sends
links, shows the queue and downloads finished files. There is no iPhone app (Apple charges a yearly fee even for free
apps): iPhone users get the web page at <https://sight8218.github.io/OPNduck/send/>.

## Get it

Not released yet. Build it with `companion/README.md`, or take the APK from a GitHub release once one is published
(the `Companion app` workflow builds and attaches it; it is signed when the repository has the signing secrets).
F-Droid metadata is in `companion/fastlane/`.

## Pair

1. On your computer: Settings, Servers, **Share this PC's engine** (choose "This computer and Tailscale"), then
   **New pair link**. Or on a server: `opnduck-server pair`.
2. In the app: **Scan QR code**, or paste the link. For sending links only (no queue or downloads) the app also takes the
   link from Settings, Send to OPNduck.

The app accepts plain http only for Tailscale addresses (and this phone itself); anything else must be https.

## What it does

- **Send:** paste a link or use Share → OPNduck in any app. Choose a format, or **Make a phone-friendly copy** (best MP4 up
  to 1080p, then converted to H.264/AAC with fast start; the original stays on the computer).
- **Queue:** live progress (refreshed every 2 seconds while the app is open), cancel.
- **Done:** every finished job with **Download to phone**: the file goes into `Downloads/OPNduck/` with the system
  downloader, so you get its notification and it resumes if the connection drops.
- **Notifications:** "<file> is ready" when a job finishes, checked every 15 minutes (the shortest Android allows)
  while your computer is reachable. Turn it off in Settings. Instant push through UnifiedPush is planned.

## Two ways to reach your computer

| | Direct (Tailscale or same network) | Relay (ntfy, from anywhere) |
| --- | --- | --- |
| Send a link | yes | yes (encrypted) |
| Queue, Done, notifications | yes | no |
| Download to phone | yes | no (a file is too big for the relay) |

Install the Tailscale app on the phone (free for personal use) and Direct works from anywhere.

## Privacy

No account, no ads, no analytics and no Google services. The device token lives under an Android Keystore key. Nothing
leaves the phone except requests to the computer or server you paired.
