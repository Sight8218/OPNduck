#!/bin/sh
# Keeps yt-dlp current (sites change often), then hands over to opnduck-server. A failed update never stops the server.
if [ "${OPNDUCK_UPDATE_YTDLP:-1}" = "1" ]; then
  yt-dlp -U >/dev/null 2>&1 || echo "yt-dlp: could not check for an update (no network?), using the installed one"
fi
exec node /opt/opnduck-server/opnduck-server.cjs "$@"
