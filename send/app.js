import { firstUrl, parsePairLink, sendLink } from './envelope.mjs'

const $ = (id) => document.getElementById(id)
const KEY = 'opnduck.pair.v1'
const DEVICE = 'opnduck.device'

/** The pairing as stored: the secret is kept as text; the rest is plain. */
const load = () => {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    return p && parsePairLink(p.link) ? { ...parsePairLink(p.link), link: p.link } : null
  } catch {
    return null
  }
}
const save = (link) => localStorage.setItem(KEY, JSON.stringify({ link }))
const defaultName = () => (/android/i.test(navigator.userAgent) ? 'Android phone' : /iphone|ipad/i.test(navigator.userAgent) ? 'iPhone' : 'Browser')

function say(text, kind = '') {
  const el = $('status')
  el.textContent = text
  el.className = kind
}

let pair = load()

function render() {
  $('pair').hidden = !!pair
  $('send').hidden = !pair
  if (pair) $('who').textContent = pair.name || 'Your computer'
  $('device').value = localStorage.getItem(DEVICE) || defaultName()
}

function doPair(text) {
  const p = parsePairLink(text)
  if (!p) return false
  const part = String(text).trim().split('#p=').pop()
  save(`https://sight8218.github.io/OPNduck/send/#p=${part}`)
  pair = load()
  render()
  return true
}

async function send(raw) {
  const url = firstUrl(raw)
  if (!url) return say('There is no web link in that.', 'bad')
  $('go').disabled = $('paste').disabled = true
  say('Sending…')
  try {
    const from = ($('device').value || defaultName()).slice(0, 40)
    localStorage.setItem(DEVICE, from)
    const how = await sendLink(pair, url, from)
    say(how === 'direct' ? 'Sent directly to your computer.' : 'Sent through the relay. It arrives when OPNduck is running.', 'ok')
    $('url').value = ''
  } catch (e) {
    say(e.message, 'bad')
  } finally {
    $('go').disabled = $('paste').disabled = false
  }
}

// The pair link arrives in the address after #p=, which is never sent to a server: store it and wipe it from the address bar.
function takeHash() {
  if (location.hash.startsWith('#p=') && doPair(location.href)) history.replaceState(null, '', location.pathname + location.search)
}
takeHash()
window.addEventListener('hashchange', takeHash) // a pair link opened while the page is already open

// Android's share sheet opens this page with ?url=&text=&title=
const params = new URLSearchParams(location.search)
const shared = firstUrl(params.get('url'), params.get('text'), params.get('title'))
if (params.has('url') || params.has('text')) history.replaceState(null, '', location.pathname)

render()
$('dopair').addEventListener('click', () => {
  $('pairmsg').textContent = doPair($('pairlink').value) ? '' : "That isn't a pair link from OPNduck."
})
$('unpair').addEventListener('click', () => {
  localStorage.removeItem(KEY)
  pair = null
  render()
})
$('go').addEventListener('click', () => void send($('url').value))
$('url').addEventListener('keydown', (e) => e.key === 'Enter' && void send($('url').value))
// iPhones cannot share into a web page, so there is a button that reads the clipboard.
$('paste').addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText()
    $('url').value = firstUrl(text)
    await send(text)
  } catch {
    say('Allow pasting, or paste the link into the box and press Send.', 'bad')
  }
})
if (pair && shared) {
  $('url').value = shared
  void send(shared)
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {})
