const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { createMcpServer } = require('../electron/mcp.cjs')

function post(info, route, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const req = http.request(
      { host: '127.0.0.1', port: info.port, path: route, method: 'POST', headers: { Authorization: `Bearer ${info.token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))))
      },
    )
    req.on('error', reject)
    req.end(data)
  })
}

async function withServer(plugins, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opnduck-mcp-'))
  const server = createMcpServer({ userDataDir: dir, tasks: new Map(), startHandlers: new Map(), cancelTask: () => false, setQueuePaused() {}, probeMedia: async () => null, plugins })
  await server.start()
  try {
    await fn(JSON.parse(fs.readFileSync(server.infoFile, 'utf8')))
  } finally {
    await server.stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

const fake = {
  tools: () => [{ name: 'demo__size', description: '[Demo] size', inputSchema: { type: 'object' }, plugin: 'demo' }],
  callTool: async (name, args) => ({ name, args }),
}

test('plugin tools are listed on /tools without the plugin field', async () => {
  await withServer(fake, async (info) => {
    const r = await post(info, '/tools', {})
    assert.equal(r.ok, true)
    assert.deepEqual(r.result, [{ name: 'demo__size', description: '[Demo] size', inputSchema: { type: 'object' } }])
  })
})

test('a `<plugin>__<tool>` call goes to the plugin host; built-in names never do', async () => {
  await withServer(fake, async (info) => {
    assert.deepEqual((await post(info, '/call', { tool: 'demo__size', args: { a: 1 } })).result, { name: 'demo__size', args: { a: 1 } })
    const bad = await post(info, '/call', { tool: 'nope', args: {} })
    assert.equal(bad.ok, false)
  })
})

test('without a plugin host /tools is empty and `__` names are unknown', async () => {
  await withServer(undefined, async (info) => {
    assert.deepEqual((await post(info, '/tools', {})).result, [])
    assert.equal((await post(info, '/call', { tool: 'demo__size', args: {} })).ok, false)
  })
})
