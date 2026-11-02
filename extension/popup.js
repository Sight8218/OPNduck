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
const api = globalThis.browser ?? globalThis.chrome
const $ = (id) => document.getElementById(id)

;(async () => {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true })
  const url = tab?.url ?? ''
  $('page').textContent = /^https?:/i.test(url) ? url : 'This page can not be sent (only web pages).'
  $('send').disabled = !/^https?:/i.test(url)
  $('send').addEventListener('click', async () => {
    $('send').disabled = true
    $('msg').className = ''
    $('msg').textContent = 'Sending…'
    const r = await api.runtime.sendMessage({ type: 'send', url })
    $('msg').className = r?.ok ? 'ok' : 'bad'
    $('msg').textContent = r?.ok ? (r.how === 'relay' ? 'Sent through the relay.' : 'Sent directly.') : (r?.error ?? 'Could not send.')
    $('send').disabled = false
  })
  $('opts').addEventListener('click', (e) => {
    e.preventDefault()
    api.runtime.openOptionsPage()
  })
})()
