# Security policy

## Supported versions

OPNduck is in beta. Only the latest release gets fixes.

| Version | Supported |
| --- | --- |
| latest `0.5.x` beta | yes |
| anything older | no |

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately: go to the repository's **Security** tab and choose **Report a vulnerability**
(GitHub private vulnerability reporting). Include what you found, how to reproduce it, and which version and
operating system you used.

You can expect a first answer within about a week. This is a one-person project, so a fix may take longer, but I
will tell you where it stands and credit you in the release notes if you want that.

## What counts

- A plugin or a web page reaching more than its permissions allow (see the sandbox and permission model in
  [PLUGINS.md](../PLUGINS.md)).
- The local MCP server accepting requests it should refuse (it should only listen on `127.0.0.1` and need its token).
- Path traversal, command injection or unsafe file writes in the job code.
- Unsafe handling of downloaded or imported files (archives, plugin packages, library imports).

## What does not

- A plugin you installed and approved doing what its permissions allow. Backends run with your user's privileges,
  so only turn on plugins you trust. This is documented, and is not a vulnerability by itself.
- Bugs that need an already-compromised computer.
- Missing features, crashes with no security impact (use a normal bug report).

## Good to know

OPNduck runs on your computer and makes network requests only to do what you asked (downloads, updates you
trigger, the optional music lookups, the plugin store). It has no accounts and no telemetry.
