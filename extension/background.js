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
// Send to OPNduck: the context-menu items and the one function that sends. The popup calls the same function.
import { parsePairLink, sendLink } from './lib/envelope.mjs'

const api = globalThis.browser ?? globalThis.chrome
const DEFAULT_PORT = 47821

/** What the options page saved: { pairLink, device, localPort }. */
export async function loadSettings() {
  const s = await api.storage.local.get(['pairLink', 'device', 'localPort'])
  const pair = s.pairLink ? parsePairLink(s.pairLink) : null
  return { pair, device: s.device || 'Browser', localPort: Number(s.localPort) || DEFAULT_PORT }
}

/** Sends one link. Returns 'local' | 'direct' | 'relay', or throws a readable Error. */
export async function sendToOpnduck(url) {
  if (!/^https?:\/\//i.test(String(url))) throw new Error('Only web links can be sent.')
  const { pair, device, localPort } = await loadSettings()
  if (!pair) throw new Error('Not paired yet. Open the extension options and paste the pair link from OPNduck.')
  return sendLink({ ...pair, local: `http://127.0.0.1:${localPort}` }, url, device)
}

async function tell(tabId, ok, text) {
  try {
    await api.action.setBadgeBackgroundColor({ color: ok ? '#2f9e44' : '#c92a2a' })
    await api.action.setBadgeText({ text: ok ? 'OK' : '!' })
    await api.action.setTitle({ title: text })
    setTimeout(() => api.action.setBadgeText({ text: '' }), 4000)
  } catch {
    /* the badge is only a courtesy */
  }
  void tabId
}

const MENU = [
  { id: 'opnduck-link', title: 'Send link to OPNduck', contexts: ['link'] },
  { id: 'opnduck-media', title: 'Send this video or audio to OPNduck', contexts: ['video', 'audio'] },
  { id: 'opnduck-page', title: 'Send this page to OPNduck', contexts: ['page', 'frame'] },
]

api.runtime.onInstalled.addListener(() => {
  api.contextMenus.removeAll(() => MENU.forEach((m) => api.contextMenus.create(m)))
})

api.contextMenus.onClicked.addListener(async (info, tab) => {
  const url = info.menuItemId === 'opnduck-link' ? info.linkUrl : info.menuItemId === 'opnduck-media' ? info.srcUrl?.startsWith('http') ? info.srcUrl : info.pageUrl : info.pageUrl
  try {
    const how = await sendToOpnduck(url)
    await tell(tab?.id, true, `Sent (${how === 'relay' ? 'through the relay' : 'directly'})`)
  } catch (e) {
    await tell(tab?.id, false, e.message)
  }
})

// The popup asks the background to send, so it works the same from both.
api.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== 'send') return false
  sendToOpnduck(msg.url).then((how) => reply({ ok: true, how }), (e) => reply({ ok: false, error: e.message }))
  return true
})
