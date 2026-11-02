/*
 * OPNduck — local-first media processing suite.
 * Copyright (C) 2026 Aaron Jonsson
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */
import { parsePairLink } from './lib/envelope.mjs'

const api = globalThis.browser ?? globalThis.chrome
const $ = (id) => document.getElementById(id)
const say = (t, ok) => {
  $('msg').textContent = t
  $('msg').className = ok ? 'ok' : 'bad'
}

;(async () => {
  const s = await api.storage.local.get(['pairLink', 'device', 'localPort'])
  $('link').value = s.pairLink ?? ''
  $('device').value = s.device ?? ''
  $('port').value = s.localPort ?? ''
})()

$('save').addEventListener('click', async () => {
  const link = $('link').value.trim()
  const pair = link ? parsePairLink(link) : null
  if (link && !pair) return say("That isn't a pair link from OPNduck.", false)
  const port = $('port').value.trim()
  if (port && !/^\d{4,5}$/.test(port)) return say('The port is a number like 47821.', false)
  // A custom relay or a Tailscale address needs the browser's permission to talk to it.
  const origins = [...new Set([pair?.relay, pair?.direct].filter((u) => u && !/^https:\/\/ntfy\.sh$/.test(u)).map((u) => `${new URL(u).protocol}//${new URL(u).hostname}/*`))] // a match pattern names the host, never a port
  if (origins.length && !(await api.permissions.contains({ origins }).catch(() => false))) {
    const granted = await api.permissions.request({ origins }).catch(() => false)
    if (!granted) return say('Without permission for the relay or direct address, those ways cannot be used.', false)
  }
  await api.storage.local.set({ pairLink: link, device: $('device').value.trim().slice(0, 40), localPort: port })
  say(pair ? `Saved. Paired with ${pair.name || 'your computer'}.` : 'Saved.', true)
})
$('unpair').addEventListener('click', async () => {
  await api.storage.local.remove('pairLink')
  $('link').value = ''
  say('Unpaired.', true)
})
