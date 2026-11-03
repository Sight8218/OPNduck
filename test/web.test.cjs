const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const W = require('../electron/core/ai/web.cjs')
const T = require('../electron/core/ai/tools.cjs')

async function server(routes) {
  const srv = http.createServer((req, res) => routes[req.url.split('?')[0]]?.(req, res) ?? (res.writeHead(404), res.end('no')))
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  return { url: `http://127.0.0.1:${srv.address().port}`, port: srv.address().port, close: () => new Promise((r) => (srv.closeAllConnections?.(), srv.close(r))) }
}

test('private and local addresses are recognised; only public http(s) links pass', () => {
  for (const a of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.20.0.1', '100.100.1.1', '169.254.169.254', '0.0.0.0', '::1', 'fd12::1', 'fe80::1', '::ffff:192.168.0.1']) assert.equal(W.isPrivateAddress(a), true, a)
  for (const a of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111']) assert.equal(W.isPrivateAddress(a), false, a)
  for (const u of ['http://localhost/x', 'http://127.0.0.1:8080/', 'http://[::1]/', 'https://nas.local/', 'http://router.internal/', 'file:///etc/passwd', 'ftp://example.com', 'https://user:pw@example.com/', 'not a url', 'http://169.254.169.254/latest/meta-data/']) assert.throws(() => W.checkUrl(u), undefined, u)
  assert.equal(W.checkUrl('https://example.com/a?b=1').hostname, 'example.com')
})

test('a name that points inward is refused when the connection is made', async () => {
  await assert.rejects(new Promise((res, rej) => W.publicOnlyLookup('localhost', {}, (e, a) => (e ? rej(e) : res(a)))), /your own network/)
})

test('a page becomes readable text: title, words, no scripts, menus or tags; entities decoded', () => {
  const { title, text } = W.htmlToText('<html><head><title>Soup &amp; Bread</title><style>p{color:red}</style></head><body><nav>Home | About</nav><script>alert(1)</script><main><h1>Potato soup</h1><p>Peel four potatoes &mdash; then boil.</p><ul><li>Salt</li><li>Pepper</li></ul></main><footer>(c) me</footer></body></html>')
  assert.equal(title, 'Soup & Bread')
  assert.match(text, /Potato soup\nPeel four potatoes - then boil\./)
  assert.ok(!/alert|color:red|Home \||\(c\) me|<|>/.test(text), text)
})

test('DuckDuckGo results: titles, real links (not the tracking redirect), snippets; adverts are skipped', () => {
  const html = `<div class="result"><h2><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fsoup&amp;rut=abc">Best <b>soup</b> recipe</a></h2><a class="result__snippet" href="x">A simple soup with <b>potatoes</b>.</a></div>
  <div class="result"><a class="result__a" href="https://duckduckgo.com/y.js?ad_provider=x">Buy now</a><a class="result__snippet">Advert</a></div>
  <div class="result"><a class="result__a" href="https://other.org/page">Other page</a><a class="result__snippet">Second &amp; last</a></div>`
  const r = W.parseDuckDuckGo(html)
  assert.deepEqual(r.map((x) => [x.title, x.url, x.snippet]), [['Best soup recipe', 'https://example.com/soup', 'A simple soup with potatoes.'], ['Other page', 'https://other.org/page', 'Second & last']])
})

test('Wikipedia results become titles, real article links and clean snippets', () => {
  const r = W.parseWikipedia({ query: { search: [{ title: 'Potato soup', snippet: 'A <span class="searchmatch">soup</span> made from potatoes &amp; stock' }, { title: 'Soup (disambiguation)', snippet: '' }] } })
  assert.deepEqual(r, [{ title: 'Potato soup', url: 'https://en.wikipedia.org/wiki/Potato_soup', snippet: 'A soup made from potatoes & stock' }, { title: 'Soup (disambiguation)', url: 'https://en.wikipedia.org/wiki/Soup_(disambiguation)', snippet: '' }])
  assert.deepEqual(W.parseWikipedia({}), [])
})

test('reading: html, plain text, redirects, big pages, non-text files, errors and silence are all handled', async () => {
  const s = await server({
    '/page': (_q, res) => (res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }), res.end('<title>T</title><body><p>Hello world</p></body>')),
    '/plain': (_q, res) => (res.writeHead(200, { 'Content-Type': 'text/plain' }), res.end('just text')),
    '/go': (_q, res) => (res.writeHead(302, { Location: '/page' }), res.end()),
    '/loop': (_q, res) => (res.writeHead(302, { Location: '/loop' }), res.end()),
    '/big': (_q, res) => (res.writeHead(200, { 'Content-Type': 'text/plain' }), res.end('x'.repeat(W.MAX_BYTES + 5000))),
    '/long': (_q, res) => (res.writeHead(200, { 'Content-Type': 'text/plain' }), res.end('y'.repeat(30000))),
    '/video': (_q, res) => (res.writeHead(200, { 'Content-Type': 'video/mp4' }), res.end('....')),
    '/err': (_q, res) => (res.writeHead(500), res.end('x')),
  })
  try {
    const web = W.createWeb({ allowPrivate: true })
    assert.deepEqual(await web.readPage(`${s.url}/page`), { url: `${s.url}/page`, title: 'T', text: 'Hello world', cut: false })
    assert.equal((await web.readPage(`${s.url}/plain`)).text, 'just text')
    assert.equal((await web.readPage(`${s.url}/go`)).text, 'Hello world')
    await assert.rejects(web.readPage(`${s.url}/loop`), /Too many redirects/)
    await assert.rejects(web.readPage(`${s.url}/big`), /too big/)
    const long = await web.readPage(`${s.url}/long`)
    assert.deepEqual([long.text.length, long.cut], [12000, true])
    await assert.rejects(web.readPage(`${s.url}/video`), /not a page of text/)
    await assert.rejects(web.readPage(`${s.url}/err`), /answered 500/)
    // Without the test switch, this very server (on 127.0.0.1) is off limits.
    await assert.rejects(W.createWeb().readPage(`${s.url}/page`), /your own network/)
  } finally {
    await s.close()
  }
})

test("search: the person's own SearXNG may be on their network, but a redirect away from it may not; results are trimmed", async () => {
  const s = await server({
    '/search': (_q, res) => (res.writeHead(200, { 'Content-Type': 'application/json' }), res.end(JSON.stringify({ results: [{ title: 'A', url: 'https://a.org', content: 'about a' }, { title: 'B', url: 'https://b.org', content: 'about b' }] }))),
    '/elsewhere/search': (_q, res) => (res.writeHead(302, { Location: 'http://169.254.169.254/latest' }), res.end()),
  })
  try {
    const mine = W.createWeb({ getConfig: () => ({ search: 'searxng', searxngUrl: s.url }) })
    assert.deepEqual((await mine.search('soup', 1)).map((x) => x.url), ['https://a.org'])
    const hop = W.createWeb({ getConfig: () => ({ search: 'searxng', searxngUrl: `${s.url}/elsewhere` }) })
    await assert.rejects(hop.search('soup'), /your own network/)
    await assert.rejects(W.createWeb({ getConfig: () => ({ search: 'searxng', searxngUrl: '' }) }).search('x'), /SearXNG/)
    await assert.rejects(W.createWeb({ getConfig: () => ({ search: 'brave' }), braveKey: () => null }).search('x'), /Brave/)
    await assert.rejects(W.createWeb().search('  '), /search for/)
  } finally {
    await s.close()
  }
})

test('the assistant gets the web tools only when internet access is on, and a look-up without it explains itself', async () => {
  assert.ok(!T.definitions().some((d) => d.name === 'web_search'))
  assert.ok(T.definitions({ web: true }).some((d) => d.name === 'web_search') && T.definitions({ web: true }).some((d) => d.name === 'read_page'))
  assert.ok(T.isRead('web_search') && T.isRead('read_page') && !T.isProposal('web_search'))
  await assert.rejects(T.readTool('web_search', { query: 'x' }, {}), /Internet access is off/)
  const web = { search: async (q) => [{ title: q, url: 'https://a.org', snippet: '' }], readPage: async (u) => ({ url: u, title: 't', text: 'body', cut: false }) }
  assert.deepEqual(await T.readTool('web_search', { query: 'soup' }, { web }), { results: [{ title: 'soup', url: 'https://a.org', snippet: '' }] })
  assert.equal((await T.readTool('read_page', { url: 'https://a.org' }, { web })).text, 'body')
  const failing = { search: async () => { throw new Error('offline') } }
  await assert.rejects(T.readTool('web_search', { query: 'x' }, { web: failing }), /offline/)
})

test('the web settings are validated', () => {
  const S = require('../electron/core/settings.cjs')
  const base = JSON.parse(JSON.stringify(S.getSettings()))
  assert.doesNotThrow(() => S.validate(base))
  for (const bad of [{ enabled: 'yes', search: 'duckduckgo', searxngUrl: '' }, { enabled: true, search: 'google', searxngUrl: '' }, { enabled: true, search: 'searxng', searxngUrl: 'ftp://x' }]) assert.throws(() => S.validate({ ...base, ai: { ...base.ai, web: bad } }), /internet access/)
})
