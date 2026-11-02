# Companion app: framework decision

Status: decided 2026-11-02. Part 3 of the roadmap plan.

## What the app has to do

Pair with a computer or server, send links (including from Android's share menu), show the queue live, and download
finished files to the phone. Android only, free to distribute (signed APK on GitHub Releases, F-Droid), no Google
services (no Firebase, no Play Services, no ML Kit).

## Options looked at

| | Reuse with the desktop app | Phone feel | F-Droid | Size |
| --- | --- | --- | --- | --- |
| Capacitor + React | Same language, build tool, theme tokens, crypto and API client | A web UI in a WebView, themed like OPNduck | Fine (all open source, no Google libraries needed) | about 5 to 10 MB |
| React Native | Same language, no shared UI | Native widgets | Possible, heavier build | 25 to 40 MB |
| Flutter | Nothing shared but the API | Smooth | Fine | 15 to 20 MB |
| Jetpack Compose | Nothing shared but the API | Most native | Easiest | 5 to 10 MB |

## Choice: Capacitor, with a phone-specific UI

Capacitor, because the parts worth sharing are not the screens but the logic, and that is TypeScript:

- the end-to-end envelope code (`extension/lib/envelope.mjs`, checked against `test/vectors/envelope.json`),
- the Engine API client (pair, tasks, events, uploads, files),
- the theme tokens and the pixel logo, so it looks like OPNduck.

The plan suggested running the desktop's own screens through a remote `src/host`. I looked and decided against it: the
desktop screens are built around local file pickers, drag and drop, folders and tool installs, none of which exist on a
phone, while the phone needs four small screens (Pair, Send, Queue, Done). Reusing the desktop pages would mean hiding
most of each. So the app has its own small React UI in `companion/` and shares the logic and look instead.

Trade-offs accepted:

- It is a WebView, so scrolling and transitions are a little less native than Compose. Fine for four list screens.
- Native pieces Capacitor does not provide are written as one small Kotlin plugin in the app (receiving the share
  intent, the system DownloadManager, notifications), instead of pulling in plugins that depend on Google libraries.
- QR scanning uses the camera in the WebView with a pure JavaScript decoder (`jsQR`), not ML Kit, which is proprietary.
- Secrets (device token, pair secret) are kept in Android Keystore-backed storage through a small native method, not
  `localStorage`.

If the WebView ever proves too slow for the queue, the logic layer stays and only the UI moves to Compose.

## Layout

```
companion/
  src/            React UI (Pair, Send, Queue, Done, Settings)
  src/lib/        envelope, Engine API client, storage (shared logic)
  android/        generated Android project + the Kotlin plugin
```
