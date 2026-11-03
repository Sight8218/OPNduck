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
/**
 * Internet access for the assistant (off until the person turns it on): two read-only look-ups, a web search and
 * reading one page. Safety first: only http(s), never this computer or the home network (checked on the address the
 * connection really uses, also after every redirect, so a name that points inward is refused), a size and a time limit,
 * and nothing it reads is ever an instruction. No Electron.
 */
const http = require('node:http')
const https = require('node:https')
const dns = require('node:dns')
const net = require('node:net')

const MAX_BYTES = 1_500_000
const TIMEOUT_MS = 10_000
const MAX_REDIRECTS = 4
const PAGE_CHARS = 12_000
const TEXT_TYPES = /^(text\/|application\/(json|xml|xhtml\+xml|rss\+xml|atom\+xml))/i

/** Addresses that are this computer, a home or company network, or otherwise not the public internet. */
function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224
  }
  if (net.isIPv6(address)) {
    const a = address.toLowerCase()
    if (a === '::' || a === '::1') return true
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a)
    if (mapped) return isPrivateAddress(mapped[1])
    return /^f[cd]/.test(a) || /^fe[89ab]/.test(a) || a.startsWith('ff')
  }
  return true // not an address at all
}

/** A lookup that refuses private answers: the connection can only go to a public address. */
const publicOnlyLookup = (hostname, options, cb) =>
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return cb(err)
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: 4 }]
    const ok = list.filter((a) => !isPrivateAddress(a.address))
    if (ok.length === 0) return cb(Object.assign(new Error('That address is on this computer or your own network, which the assistant may not open'), { code: 'EPRIVATE' }))
    if (options?.all) return cb(null, ok)
    cb(null, ok[0].address, ok[0].family)
  })

/** The link as a URL, or an error that says what is wrong. */
function checkUrl(raw) {
  let u
  try {
    u = new URL(String(raw))
  } catch {
    throw new Error('That is not a web address')
  }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Only http and https addresses can be opened')
  if (u.username || u.password) throw new Error('Addresses with a login in them are not opened')
  if (net.isIP(u.hostname.replace(/^\[|\]$/g, '')) && isPrivateAddress(u.hostname.replace(/^\[|\]$/g, ''))) throw new Error('That address is on this computer or your own network, which the assistant may not open')
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(u.hostname)) throw new Error('That address is on this computer or your own network, which the assistant may not open')
  return u
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', hellip: '...', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"' }
const decode = (t) =>
  t.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })

/** A web page as readable text: the title and the words, without scripts, styles, menus and tags. */
function htmlToText(html) {
  const title = decode((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' ').trim())
  let body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(head|title|script|style|noscript|svg|template|nav|footer|header|aside|form|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
  const main = /<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(body)
  if (main && main[2].length > 500) body = main[2]
  body = body.replace(/<\/(p|div|li|h[1-6]|tr|br|section|blockquote|pre)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')
  const text = decode(body)
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { title, text }
}

/** DuckDuckGo's plain HTML results page as a list of { title, url, snippet }. */
function parseDuckDuckGo(html) {
  const out = []
  const re = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]+class="[^"]*result__a|$)/gi
  for (const m of html.matchAll(re)) {
    let href = decode(m[1])
    if (href.startsWith('//')) href = `https:${href}`
    const redirect = /[?&]uddg=([^&]+)/.exec(href)
    if (redirect) href = decodeURIComponent(redirect[1])
    if (!/^https?:\/\//i.test(href) || /duckduckgo\.com\/y\.js/.test(href)) continue // adverts and junk
    const snippet = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>|class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(m[3])
    out.push({ title: decode(m[2].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim(), url: href, snippet: decode((snippet?.[1] ?? snippet?.[2] ?? '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim().slice(0, 300) })
  }
  return out
}

/** Wikipedia's search API answer as a list of { title, url, snippet }. */
function parseWikipedia(json, lang = 'en') {
  return (json?.query?.search ?? []).map((x) => ({
    title: String(x.title ?? ''),
    url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(x.title ?? '').replace(/ /g, '_'))}`,
    snippet: decode(String(x.snippet ?? '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim().slice(0, 300),
  }))
}

/**
 * @param {object} [deps]
 * @param {boolean} [deps.allowPrivate]  tests only: a local test server is "private"
 * @param {() => { search: string, searxngUrl: string }} [deps.getConfig]
 * @param {() => string|null} [deps.braveKey]
 */
function createWeb({ allowPrivate = false, getConfig = () => ({ search: 'wikipedia', searxngUrl: '' }), braveKey = () => null } = {}) {
  /** One GET with every limit applied. `trusted` is a host the person chose themselves (their own SearXNG), allowed to be private. */
  function get(rawUrl, { headers = {}, trustedHost = null, redirects = 0 } = {}) {
    return new Promise((resolve, reject) => {
      let u
      try {
        u = allowPrivate ? new URL(String(rawUrl)) : trustedHost && new URL(String(rawUrl)).hostname === trustedHost ? new URL(String(rawUrl)) : checkUrl(rawUrl)
      } catch (err) {
        return reject(err)
      }
      const mod = u.protocol === 'https:' ? https : http
      const req = mod.request(u, { method: 'GET', headers: { 'User-Agent': 'OPNduck-assistant/0.6 (+https://github.com/Sight8218/OPNduck)', Accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.1', 'Accept-Encoding': 'identity', ...headers }, lookup: allowPrivate || (trustedHost && u.hostname === trustedHost) ? undefined : publicOnlyLookup, timeout: TIMEOUT_MS }, (res) => {
        const status = res.statusCode ?? 0
        if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
          res.resume()
          if (redirects >= MAX_REDIRECTS) return reject(new Error('Too many redirects'))
          let next
          try {
            next = new URL(res.headers.location, u).toString()
          } catch {
            return reject(new Error('A bad redirect'))
          }
          return get(next, { headers, trustedHost, redirects: redirects + 1 }).then(resolve, reject)
        }
        const type = String(res.headers['content-type'] ?? '')
        if (status >= 400) {
          res.resume()
          return reject(new Error(`The site answered ${status}`))
        }
        if (type && !TEXT_TYPES.test(type)) {
          res.resume()
          return reject(new Error(`That is not a page of text (${type.split(';')[0]})`))
        }
        const chunks = []
        let size = 0
        res.on('data', (c) => {
          size += c.length
          if (size > MAX_BYTES) {
            req.destroy(Object.assign(new Error('That page is too big to read'), { code: 'ETOOBIG' }))
          } else chunks.push(c)
        })
        res.on('end', () => resolve({ url: u.toString(), type, body: Buffer.concat(chunks).toString('utf8') }))
        res.on('error', reject)
      })
      req.on('timeout', () => req.destroy(new Error('The site took too long to answer')))
      req.on('error', (err) => reject(err.code === 'EPRIVATE' || err.code === 'ETOOBIG' ? err : err.message && /took too long|too big/.test(err.message) ? err : new Error(`Could not open it: ${err.code ?? err.message}`)))
      req.end()
    })
  }

  /** Reads one page: { url, title, text }. The text is cut to a size a small model can use. */
  async function readPage(url) {
    const r = await get(url)
    if (/html|xml/i.test(r.type) || /^\s*<(!doctype|html)/i.test(r.body)) {
      const { title, text } = htmlToText(r.body)
      return { url: r.url, title, text: text.slice(0, PAGE_CHARS), cut: text.length > PAGE_CHARS }
    }
    return { url: r.url, title: '', text: r.body.slice(0, PAGE_CHARS), cut: r.body.length > PAGE_CHARS }
  }

  /** A web search: up to `n` results of { title, url, snippet }. */
  async function search(query, n = 5) {
    const q = String(query ?? '').trim().slice(0, 300)
    if (!q) throw new Error('What should it search for?')
    const cfg = getConfig()
    if (cfg.search === 'brave') {
      const key = braveKey()
      if (!key) throw new Error('Add your Brave Search key in Settings > AI assistant first')
      const r = await get(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${n}`, { headers: { Accept: 'application/json', 'X-Subscription-Token': key } })
      const j = JSON.parse(r.body)
      return (j.web?.results ?? []).slice(0, n).map((x) => ({ title: String(x.title ?? ''), url: String(x.url ?? ''), snippet: decode(String(x.description ?? '').replace(/<[^>]+>/g, '')).slice(0, 300) }))
    }
    if (cfg.search === 'searxng') {
      if (!cfg.searxngUrl) throw new Error('Add the address of your SearXNG server in Settings > AI assistant first')
      const base = new URL(cfg.searxngUrl)
      const r = await get(`${base.origin}${base.pathname.replace(/\/$/, '')}/search?q=${encodeURIComponent(q)}&format=json`, { trustedHost: base.hostname, headers: { Accept: 'application/json' } })
      const j = JSON.parse(r.body)
      return (j.results ?? []).slice(0, n).map((x) => ({ title: String(x.title ?? ''), url: String(x.url ?? ''), snippet: String(x.content ?? '').slice(0, 300) }))
    }
    if (cfg.search === 'duckduckgo') {
      // Best effort: DuckDuckGo has no search API, and it often answers an automated request with a check page instead of results.
      const r = await get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`)
      const list = parseDuckDuckGo(r.body).slice(0, n)
      if (list.length === 0) throw new Error('DuckDuckGo gave no results (it often refuses automated searches). Choose Wikipedia, Brave Search or your own SearXNG in Settings > AI assistant.')
      return list
    }
    const r = await get(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=${n}&format=json&origin=*`, { headers: { Accept: 'application/json' } })
    const list = parseWikipedia(JSON.parse(r.body))
    if (list.length === 0) throw new Error('Wikipedia has nothing for that search')
    return list
  }

  return { readPage, search, get }
}

module.exports = { parseWikipedia, publicOnlyLookup, createWeb, isPrivateAddress, checkUrl, htmlToText, parseDuckDuckGo, MAX_BYTES }
