# Send to OPNduck

Send a link from your phone, a browser or another computer, and OPNduck downloads it. Turn it on in
**Settings → Send to OPNduck** (it is off by default).

Only the **link** travels. The format, quality and folder always come from your own settings ("Download as",
default MP4, best quality), so nothing sent from another device can choose a folder or add options to a download.

## How a link gets there

| Way | When to use it | What it needs |
| --- | --- | --- |
| **opnduck:// link** | A web page or launcher opens `opnduck://send?url=<link>` | Nothing. It always waits for your click, even in "download straight away" mode, because any web page can open such a link. |
| **This computer** | The browser extension on the same PC | The link server set to "This computer only" or more. |
| **Tailscale (direct)** | Your phone or laptop on your own Tailscale network | The link server set to "This computer and Tailscale". For the phone page you also need Tailscale HTTPS (below). |
| **Relay (ntfy)** | From anywhere, with no setup | Nothing else: scan the code once. Uses https://ntfy.sh, or your own ntfy server. |

The senders try them in that order (this computer, Tailscale, relay) and say which one worked.

## Pairing

Settings shows a QR code and a **Copy pair link** button. Scan the code with your phone's camera, or paste the
link into the browser extension's options. The link holds a private key (the *pairing secret*, 32 random bytes made
on first use and kept in `remote.json` next to your settings, readable only by you). It sits after the `#` in the
link, which browsers never send to a website. **Reset pairing** makes a new key and unpairs everything.

## What is private

- Every message is **encrypted on the sending device** (AES-256-GCM, key derived from the pairing secret) and only
  OPNduck can read it. The relay server sees random text, its size and when it was sent. It never sees the link.
- The relay channel name is derived from the secret, so nobody can guess it.
- Messages older than 24 hours, from the future, repeated, or badly formed are dropped, and at most 30 messages a minute are
  accepted.
- The link server only answers `GET /v1/health` and one `POST /v1/send` that needs your key. It never serves files
  and refuses bodies over 8 KB. It listens only where you chose: nowhere (default), this computer, this computer
  plus your Tailscale address, or (advanced, with a warning) your whole network.
- Web pages other than the project's phone page (and browser extensions) cannot call the link server.

## Phone page

Open <https://sight8218.github.io/OPNduck/send/> after scanning the code (the code opens it already paired). On
Android, add it to your home screen and it appears in the share menu: share a link from any app straight to OPNduck.
On an iPhone, copy the link and press **Paste & send**.

To use the direct path from a phone, the phone page (https) needs an https address for your computer. In Settings,
choose "This computer and Tailscale", turn on HTTPS certificates for your tailnet in the Tailscale admin page (DNS
tab), and press **Enable HTTPS over Tailscale**. If that is not possible, the relay works without it.

## Browser extension

`npm run build:extension` makes `dist-extension/opnduck-extension-chrome-<version>.zip` and `...-firefox-...zip`.
Chrome: unzip, open `chrome://extensions`, turn on Developer mode, **Load unpacked**. Firefox: `about:debugging`,
**This Firefox**, **Load Temporary Add-on**, choose `manifest.json` from the unzipped Firefox build. Then open the
extension's options and paste the pair link. Right-click a link, video, audio or page and choose
**Send to OPNduck**, or use the toolbar button for the current page.

## Technical notes

- Message format and key derivation: `electron/core/remote/envelope.cjs` (Node) and `extension/lib/envelope.mjs`
  (browsers, WebCrypto). `test/vectors/envelope.json` pins both.
- The inbox (`electron/core/remote/inbox.cjs`) is the only place a received link becomes a download.
- The link server is the first slice of the Engine API: `engine-api/server.cjs`, mounted under `/v1`.
