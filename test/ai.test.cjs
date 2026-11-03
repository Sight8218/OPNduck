const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { readSse } = require('../electron/core/ai/sse.cjs')
const { createOpenAiProvider } = require('../electron/core/ai/providers/openai.cjs')
const { createAnthropicProvider, wire: anthropicWire } = require('../electron/core/ai/providers/anthropic.cjs')
const { createGeminiProvider, schemaFor, wire: geminiWire } = require('../electron/core/ai/providers/gemini.cjs')
const { createAi, addressOk } = require('../electron/core/ai/index.cjs')
const { createKeys } = require('../electron/core/ai/keys.cjs')
const aiTools = require('../electron/core/ai/tools.cjs')

/** A tiny server: `script(req, body)` returns { status, events: [[event, data]...] | json, raw }. Splits writes oddly to test the SSE reader. */
async function server(script) {
  const seen = []
  const srv = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null
      seen.push({ url: req.url, headers: req.headers, body })
      const r = script(req, body, seen.length)
      res.writeHead(r.status ?? 200, { 'Content-Type': r.events ? 'text/event-stream' : 'application/json' })
      if (!r.events) return res.end(JSON.stringify(r.json ?? {}))
      const text = r.events.map(([e, d]) => `${e ? `event: ${e}\r\n` : ''}data: ${typeof d === 'string' ? d : JSON.stringify(d)}\r\n\r\n`).join('')
      const mid = Math.floor(text.length / 2) + 3 // a cut in the middle of an event
      res.write(text.slice(0, mid))
      setTimeout(() => res.end(text.slice(mid)), 10)
    })
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  return { url: `http://127.0.0.1:${srv.address().port}`, seen, close: () => (srv.closeAllConnections(), new Promise((r) => srv.close(r))) }
}
const collect = async (gen) => {
  const out = { text: '', thinking: '', calls: [], done: null }
  for await (const ev of gen) {
    if (ev.type === 'text') out.text += ev.delta
    else if (ev.type === 'thinking') out.thinking += ev.delta
    else if (ev.type === 'tool_call') out.calls.push(ev)
    else if (ev.type === 'done') out.done = ev
  }
  return out
}

test('the SSE reader handles events split anywhere, CRLF, comments and a missing final blank line', async () => {
  const body = new Response(': hi\r\nevent: a\r\ndata: {"x":1}\r\n\r\ndata: one\r\ndata: two\r\n\r\ndata: last')
  const parts = []
  const stream = new ReadableStream({ start(c) { const t = new TextEncoder().encode(': hi\r\nevent: a\r\ndata: {"x":1}\r\n\r\ndata: one\r\ndata: two\r\n\r\ndata: last'); for (let i = 0; i < t.length; i += 5) c.enqueue(t.slice(i, i + 5)); c.close() } })
  for await (const e of readSse({ body: stream })) parts.push(e)
  assert.deepEqual(parts, [{ event: 'a', data: '{"x":1}' }, { event: 'message', data: 'one\ntwo' }, { event: 'message', data: 'last' }])
  void body
})

test('OpenAI format: text, thinking, split tool calls, usage, JSON schema and images are all handled', async () => {
  const s = await server((req) => (req.url.endsWith('/models') ? { json: { data: [{ id: 'm1' }, { id: 'm2' }] } } : {
    events: [
      [null, { choices: [{ delta: { reasoning_content: 'hmm ' } }] }],
      [null, { choices: [{ delta: { content: 'Hel' } }] }],
      [null, { choices: [{ delta: { content: 'lo' } }] }],
      [null, { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'list_', arguments: '{"sta' } }] } }] }],
      [null, { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'jobs', arguments: 'tus":"done"}' } }] } }] }],
      [null, { choices: [], usage: { prompt_tokens: 12, completion_tokens: 7 } }],
      [null, '[DONE]'],
    ],
  }))
  try {
    const p = createOpenAiProvider({ baseUrl: `${s.url}/v1`, apiKey: 'sk-test' })
    assert.deepEqual((await p.models()).map((m) => m.id), ['m1', 'm2'])
    const schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false }
    const r = await collect(p.chat({ model: 'm1', messages: [{ role: 'system', content: 'be brief' }, { role: 'user', content: 'hi', images: ['data:image/png;base64,AAAA'] }], tools: [{ name: 'list_jobs', description: 'd', parameters: { type: 'object', properties: {} } }], jsonSchema: schema, temperature: 0.2, maxTokens: 50 }))
    assert.equal(r.text, 'Hello')
    assert.equal(r.thinking, 'hmm ')
    assert.deepEqual(r.calls.map((c) => [c.id, c.name, c.args]), [['c1', 'list_jobs', { status: 'done' }]])
    assert.deepEqual(r.done.usage, { input: 12, output: 7 })
    assert.deepEqual(r.done.message.tool_calls[0].args, { status: 'done' })
    const sent = s.seen[1]
    assert.equal(sent.headers.authorization, 'Bearer sk-test')
    assert.equal(sent.body.response_format.json_schema.schema.required[0], 'a')
    assert.equal(sent.body.messages[1].content[1].image_url.url, 'data:image/png;base64,AAAA')
    assert.equal(sent.body.tools[0].function.name, 'list_jobs')
  } finally {
    await s.close()
  }
})

test('errors are readable: a bad key, a rate limit, and a server that is not there', async () => {
  const s = await server(() => ({ status: 401, json: { error: { message: 'Incorrect API key provided' } } }))
  try {
    await assert.rejects(collect(createOpenAiProvider({ baseUrl: `${s.url}/v1`, apiKey: 'bad' }).chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] })), /401 \(check the API key\): Incorrect API key/)
  } finally {
    await s.close()
  }
  await assert.rejects(collect(createOpenAiProvider({ baseUrl: 'http://127.0.0.1:1/v1' }).chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] })), /Cannot reach/)
})

test('Anthropic: headers, system text, tool use, thinking, a structured answer through a forced tool, and usage', async () => {
  const s = await server((req, body) => (req.url.startsWith('/v1/models') ? { json: { data: [{ id: 'claude-x', display_name: 'Claude X' }] } } : {
    events: body.tool_choice
      ? [
          ['message_start', { type: 'message_start', message: { usage: { input_tokens: 20 } } }],
          ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't1', name: 'answer' } }],
          ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"a":' } }],
          ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"yes"}' } }],
          ['content_block_stop', { type: 'content_block_stop', index: 0 }],
          ['message_delta', { type: 'message_delta', usage: { output_tokens: 9 } }],
        ]
      : [
          ['message_start', { type: 'message_start', message: { usage: { input_tokens: 30 } } }],
          ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }],
          ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'let me think' } }],
          ['content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'text' } }],
          ['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Sure.' } }],
          ['content_block_start', { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'tu', name: 'job_status' } }],
          ['content_block_delta', { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"id":"abc"}' } }],
          ['content_block_stop', { type: 'content_block_stop', index: 2 }],
          ['message_delta', { type: 'message_delta', usage: { output_tokens: 15 } }],
        ],
  }))
  try {
    const p = createAnthropicProvider({ apiKey: 'sk-ant-x', baseUrl: s.url })
    assert.deepEqual(await p.models(), [{ id: 'claude-x', name: 'Claude X', vision: true }])
    const r = await collect(p.chat({ model: 'claude-x', messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }], tools: [{ name: 'job_status', description: 'd', parameters: { type: 'object', properties: { id: { type: 'string' } } } }], reasoning: 'on', effort: 'medium', temperature: 0.2, maxTokens: 100 }))
    assert.equal(r.text, 'Sure.')
    assert.equal(r.thinking, 'let me think')
    assert.deepEqual(r.calls.map((c) => [c.name, c.args]), [['job_status', { id: 'abc' }]])
    assert.deepEqual(r.done.usage, { input: 30, output: 15 })
    const sent = s.seen[1]
    assert.equal(sent.headers['x-api-key'], 'sk-ant-x')
    assert.equal(sent.headers['anthropic-version'], '2023-06-01')
    assert.equal(sent.body.system, 'sys')
    assert.equal(sent.body.thinking.budget_tokens, 2048)
    assert.ok(sent.body.max_tokens > sent.body.thinking.budget_tokens)
    assert.equal(sent.body.temperature, undefined, 'no temperature while thinking')
    assert.equal(sent.body.tools[0].input_schema.type, 'object')
    const j = await collect(p.chat({ model: 'claude-x', messages: [{ role: 'user', content: 'q' }], jsonSchema: { type: 'object', properties: { a: { type: 'string' } } } }))
    assert.equal(j.text, '{"a":"yes"}', 'a structured answer comes back as JSON text')
    assert.equal(s.seen[2].body.tool_choice.name, 'answer')
  } finally {
    await s.close()
  }
})

test('Anthropic messages: tool results become user turns, same-role turns merge, images become blocks', () => {
  const { system, messages } = anthropicWire([
    { role: 'system', content: 'S' },
    { role: 'user', content: 'a', images: ['data:image/jpeg;base64,QQ=='] },
    { role: 'assistant', content: 'calling', tool_calls: [{ id: 't', name: 'x', args: { n: 1 } }] },
    { role: 'tool', tool_call_id: 't', content: { ok: true } },
    { role: 'user', content: 'thanks' },
  ])
  assert.equal(system, 'S')
  assert.deepEqual(messages.map((m) => m.role), ['user', 'assistant', 'user'])
  assert.equal(messages[0].content[0].source.media_type, 'image/jpeg')
  assert.deepEqual(messages[1].content[1], { type: 'tool_use', id: 't', name: 'x', input: { n: 1 } })
  assert.equal(messages[2].content[0].type, 'tool_result')
  assert.equal(messages[2].content[1].text, 'thanks', 'the tool result and the next user turn are one turn')
})

test('Gemini: header key, system instruction, function calls, structured output, thinking and usage', async () => {
  const s = await server((req) => (req.url.startsWith('/v1beta/models?') ? { json: { models: [{ name: 'models/gem-1', displayName: 'Gem 1', supportedGenerationMethods: ['generateContent'] }, { name: 'models/emb', supportedGenerationMethods: ['embedContent'] }] } } : {
    events: [
      [null, { candidates: [{ content: { parts: [{ text: 'pondering', thought: true }] } }] }],
      [null, { candidates: [{ content: { parts: [{ text: 'Hi ' }] } }] }],
      [null, { candidates: [{ content: { parts: [{ text: 'there' }, { functionCall: { name: 'list_jobs', args: { status: 'done' } } }] } }], usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 4, thoughtsTokenCount: 2 } }],
    ],
  }))
  try {
    const p = createGeminiProvider({ apiKey: 'AIza-test', baseUrl: s.url })
    assert.deepEqual((await p.models()).map((m) => m.id), ['gem-1'])
    const r = await collect(p.chat({ model: 'gem-1', messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }], tools: [{ name: 'list_jobs', description: 'd', parameters: { type: 'object', properties: { status: { type: ['string', 'null'] } }, additionalProperties: false } }], jsonSchema: { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false }, reasoning: 'on', effort: 'high' }))
    assert.equal(r.text, 'Hi there')
    assert.equal(r.thinking, 'pondering')
    assert.deepEqual(r.calls.map((c) => [c.name, c.args]), [['list_jobs', { status: 'done' }]])
    assert.deepEqual(r.done.usage, { input: 8, output: 6 })
    const sent = s.seen[1]
    assert.match(sent.url, /^\/v1beta\/models\/gem-1:streamGenerateContent\?alt=sse$/)
    assert.equal(sent.headers['x-goog-api-key'], 'AIza-test')
    assert.equal(sent.body.systemInstruction.parts[0].text, 'sys')
    assert.equal(sent.body.generationConfig.responseMimeType, 'application/json')
    assert.equal(sent.body.generationConfig.thinkingConfig.thinkingBudget, 4096)
    assert.equal(sent.body.generationConfig.responseSchema.additionalProperties, undefined)
    assert.equal(sent.body.tools[0].functionDeclarations[0].parameters.properties.status.type, 'string')
  } finally {
    await s.close()
  }
  assert.equal(schemaFor({ type: ['null', 'integer'] }).type, 'integer')
  const { contents } = geminiWire([{ role: 'assistant', content: '', tool_calls: [{ id: 'c', name: 'f', args: {} }] }, { role: 'tool', tool_call_id: 'c', content: '[1,2]' }])
  assert.deepEqual(contents[1].parts[0].functionResponse, { name: 'f', response: { result: [1, 2] } })
})

test('addresses: https anywhere; plain http only on this computer and Tailscale', () => {
  for (const ok of ['https://api.example.com/v1', 'http://127.0.0.1:1234/v1', 'http://localhost:11434', 'http://100.109.225.70:8080', 'http://box.tail1.ts.net/v1']) assert.equal(addressOk(ok), true, ok)
  for (const bad of ['http://192.168.1.5:1234', 'http://example.com', 'ftp://x', 'nonsense', '']) assert.equal(addressOk(bad), false, bad)
})

test('keys are sealed on disk with mode 0600, listed without their values, and refused when they look wrong', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aik-')), 'k.json')
  const keys = createKeys({ file, seal: (t) => `S:${Buffer.from(t).toString('base64')}`, unseal: (s) => Buffer.from(s.slice(2), 'base64').toString() })
  keys.set('anthropic', 'sk-ant-secret-123')
  assert.equal(keys.get('anthropic'), 'sk-ant-secret-123')
  assert.ok(!fs.readFileSync(file, 'utf8').includes('sk-ant-secret'))
  assert.equal(fs.statSync(file).mode & 0o777, 0o600)
  assert.deepEqual(keys.has(), ['anthropic'])
  assert.throws(() => keys.set('anthropic', 'short'), /does not look like/)
  assert.throws(() => keys.set('Bad Name!', 'sk-ant-secret-123'), /Unknown provider/)
  keys.remove('anthropic')
  assert.equal(keys.get('anthropic'), null)
})

function makeAi(settings, keys = {}, fetchFn = fetch) {
  const ai = { provider: 'off', model: '', machineUrl: '', cloud: 'anthropic', customUrl: '', effort: 'medium', reasoning: 'auto', vision: false, temperature: 0.7, keepChats: true, ...settings }
  return createAi({ getSettings: () => ({ ai }), keys: { get: (id) => keys[id] ?? null }, fetchFn })
}

test('the runtime picks the provider from settings, explains what is missing, and maps effort to reasoning and limits', async () => {
  assert.throws(() => makeAi({}).provider(), /AI is turned off/)
  assert.throws(() => makeAi({ provider: 'machine' }).provider(), /address of the other computer/)
  assert.throws(() => makeAi({ provider: 'machine', machineUrl: 'http://192.168.1.9:1/v1' }).provider(), /https/)
  assert.throws(() => makeAi({ provider: 'cloud', cloud: 'openai' }).provider(), /OpenAI API key/)
  assert.throws(() => makeAi({ provider: 'cloud', cloud: 'custom' }, { custom: 'sk-12345678' }).provider(), /https/)
  assert.equal(makeAi({ provider: 'cloud', cloud: 'anthropic' }, { anthropic: 'sk-ant-12345' }).provider().kind, 'anthropic')
  assert.equal(makeAi({ provider: 'cloud', cloud: 'gemini' }, { gemini: 'AIza12345678' }).provider().kind, 'gemini')
  assert.equal(makeAi({ provider: 'cloud', cloud: 'groq' }, { groq: 'gsk_12345678' }).provider().baseUrl, 'https://api.groq.com/openai/v1')
  assert.equal(makeAi({ provider: 'ollama' }).provider().baseUrl, 'http://127.0.0.1:11434/v1')
  assert.deepEqual([makeAi({ effort: 'low' }).options().reasoning, makeAi({ effort: 'high' }).options().reasoning, makeAi({ effort: 'low', reasoning: 'on' }).options().reasoning], ['off', 'on', 'on'])
  assert.deepEqual([makeAi({ effort: 'low' }).options().maxTokens, makeAi({ effort: 'high' }).options().maxTokens], [1000, 4000])
  await assert.rejects(collect(makeAi({ provider: 'ollama' }).chat({ messages: [] })), /Choose a model/)
})

test('vision off means images never leave: they are stripped before the provider sees them', async () => {
  const s = await server(() => ({ events: [[null, { choices: [{ delta: { content: 'ok' } }] }], [null, '[DONE]']] }))
  try {
    const ai = makeAi({ provider: 'machine', model: 'm', machineUrl: `${s.url}/v1`, vision: false })
    await collect(ai.chat({ messages: [{ role: 'user', content: 'look', images: ['data:image/png;base64,AAAA'] }] }))
    assert.equal(typeof s.seen[0].body.messages[0].content, 'string')
    const on = makeAi({ provider: 'machine', model: 'm', machineUrl: `${s.url}/v1`, vision: true })
    await collect(on.chat({ messages: [{ role: 'user', content: 'look', images: ['data:image/png;base64,AAAA'] }] }))
    assert.equal(s.seen[1].body.messages[0].content[1].type, 'image_url')
  } finally {
    await s.close()
  }
})

const deps = (extra = {}) => ({
  tasks: new Map([['j1', { state: { id: 'j1', kind: 'convert', status: 'error', progress: 0.5, label: 'a.mp4', error: 'boom' }, log: { lines: ['x', 'y'] } }]]),
  isKnownFile: (p) => p === '/media/a.mp4',
  probeMedia: async (p) => ({ path: p, duration: 3 }),
  analyzeMedia: async () => ({ width: 640 }),
  suggest: () => ({ settings: [] }),
  recipes: { list: () => [], get: () => null },
  getRecipe: () => null,
  ...extra,
})

test('tool bridge: the model gets the job tools and the look-up tools, nothing that deletes or cancels', () => {
  const names = aiTools.definitions().map((d) => d.name)
  for (const n of ['download', 'convert', 'jump_cut', 'restore', 'beat_cut', 'probe_media', 'list_jobs', 'job_status', 'suggest_settings', 'run_recipe']) assert.ok(names.includes(n), n)
  for (const n of ['cancel_job', 'queue_pause', 'queue_resume']) assert.ok(!names.includes(n), `${n} must not be offered`)
  assert.ok(aiTools.definitions().every((d) => d.parameters?.type === 'object'))
})

test('proposals are checked: schema, links, and only files the person picked or that are in the Library', () => {
  const p = aiTools.propose('convert', { inputPath: '/media/a.mp4', container: 'MKV' }, deps())
  assert.deepEqual([p.tool, p.channel, p.req.container], ['convert', 'tasks:startConvert', 'MKV'])
  assert.throws(() => aiTools.propose('convert', { inputPath: '/etc/passwd', container: 'MKV' }, deps()), /not a file the person picked/)
  assert.throws(() => aiTools.propose('convert', { inputPath: 'a.mp4', container: 'MKV' }, deps()), /absolute/)
  assert.throws(() => aiTools.propose('convert', { inputPath: '/media/a.mp4' }, deps()), /Missing argument/)
  assert.throws(() => aiTools.propose('convert', { inputPath: '/media/a.mp4', container: 'MKV', destination: '/tmp' }, deps()), /Unknown argument/)
  assert.throws(() => aiTools.propose('download', { url: 'file:///etc/passwd' }, deps()), /http/)
  assert.equal(aiTools.propose('download', { url: 'https://example.com/v' }, deps()).req.url, 'https://example.com/v')
  assert.throws(() => aiTools.propose('list_jobs', {}, deps()), /not a tool that starts/)
  assert.throws(() => aiTools.propose('beat_cut', { inputPath: '/media/a.mp4', clips: ['/etc/passwd'] }, deps()), /not a file the person picked/)
  assert.throws(() => aiTools.propose('run_recipe', { recipe: 'nope', input: '/media/a.mp4' }, deps()), /No recipe/)
})

test('read tools answer at once and refuse unknown files', async () => {
  const d = deps()
  assert.equal((await aiTools.readTool('list_jobs', {}, d))[0].error, 'boom')
  assert.deepEqual((await aiTools.readTool('job_status', { id: 'j1', logLines: 1 }, d)).log, ['y'])
  await assert.rejects(aiTools.readTool('job_status', { id: 'zz' }, d), /No job/)
  assert.equal((await aiTools.readTool('probe_media', { path: '/media/a.mp4' }, d)).duration, 3)
  await assert.rejects(aiTools.readTool('probe_media', { path: '/etc/passwd' }, d), /not a file the person picked/)
  assert.equal((await aiTools.readTool('suggest_settings', { tool: 'convert', inputPath: '/media/a.mp4' }, d)).facts.width, 640)
})

test('the agent loop: it looks up a job, then proposes a conversion; the answer comes back with the plan and nothing has started', async () => {
  let round = 0
  const s = await server((req, body) => {
    round++
    if (round === 1) return { events: [[null, { choices: [{ delta: { tool_calls: [{ index: 0, id: 'a', function: { name: 'list_jobs', arguments: '{}' } }] } }] }], [null, '[DONE]']] }
    if (round === 2) return { events: [[null, { choices: [{ delta: { content: 'I will convert it.', tool_calls: [{ index: 0, id: 'b', function: { name: 'convert', arguments: '{"inputPath":"/media/a.mp4","container":"MKV"}' } }, { index: 1, id: 'c', function: { name: 'convert', arguments: '{"inputPath":"/etc/passwd","container":"MKV"}' } }] } }] }], [null, { choices: [], usage: { prompt_tokens: 5, completion_tokens: 3 } }], [null, '[DONE]']] }
    return { events: [[null, { choices: [{ delta: { content: 'Done: one plan.' } }] }], [null, '[DONE]']] }
  })
  try {
    const ai = makeAi({ provider: 'machine', model: 'm', machineUrl: `${s.url}/v1` })
    const events = []
    const r = await ai.agent({ messages: [{ role: 'user', content: 'convert a.mp4 to mkv' }], deps: deps(), system: 'You are the duck.', onEvent: (e) => events.push(e.type) })
    assert.equal(r.proposals.length, 1)
    assert.equal(r.proposals[0].req.container, 'MKV')
    assert.equal(r.message.content, 'Done: one plan.')
    const toolMsgs = s.seen[2].body.messages.filter((m) => m.role === 'tool')
    assert.equal(toolMsgs.length, 3)
    assert.match(toolMsgs[2].content, /not a file the person picked/, 'the bad call was answered with the reason, so the model can fix itself')
    assert.ok(events.includes('tool_result'))
    assert.equal(s.seen[0].body.messages[0].content, 'You are the duck.')
  } finally {
    await s.close()
  }
})

test('the agent stops after 10 tool calls in one request', async () => {
  const s = await server(() => ({ events: [[null, { choices: [{ delta: { tool_calls: Array.from({ length: 4 }, (_, i) => ({ index: i, id: `x${i}`, function: { name: 'list_jobs', arguments: '{}' } })) } }] }], [null, '[DONE]']] }))
  try {
    const ai = makeAi({ provider: 'machine', model: 'm', machineUrl: `${s.url}/v1` })
    const r = await ai.agent({ messages: [{ role: 'user', content: 'loop' }], deps: deps() })
    assert.ok(s.seen.length <= 4, `rounds: ${s.seen.length}`)
    assert.ok(r.message)
  } finally {
    await s.close()
  }
})

test('conversations: saved as files, listed newest first, bad ids refused, and removable', () => {
  const { createChats } = require('../electron/core/ai/chats.cjs')
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'chats-')), 'chats')
  const c = createChats({ dir })
  assert.deepEqual(c.list(), [])
  const id1 = '11111111-1111-1111-1111-111111111111'
  const id2 = '22222222-2222-2222-2222-222222222222'
  c.save({ id: id1, title: 'First', messages: [{ role: 'user', content: 'hi' }] })
  c.save({ id: id2, title: 'Second', messages: [] })
  assert.equal(c.get(id1).messages[0].content, 'hi')
  assert.equal(c.list().length, 2)
  assert.equal(fs.statSync(path.join(dir, `${id1}.json`)).mode & 0o777, 0o600)
  assert.throws(() => c.get('../../etc/passwd') ?? (() => { throw new Error('x') })(), /x|Bad/)
  assert.equal(c.get('../../etc/passwd'), null)
  assert.throws(() => c.save({ id: '../x', title: 't', messages: [] }), /Bad conversation id/)
  assert.throws(() => c.save({ id: id1, title: 't', messages: 'no' }), /Not a conversation/)
  c.remove(id1)
  assert.equal(c.get(id1), null)
  c.removeAll()
  assert.deepEqual(c.list(), [])
})

test('the system prompt tells the model it only proposes, lists known files, and stays short', () => {
  const { systemPrompt } = require('../electron/core/ai/prompt.cjs')
  const p = systemPrompt({ files: ['/media/a.mp4'], recentJobs: ['convert done: a.mp4'] })
  assert.match(p, /only PROPOSES/)
  assert.match(p, /\/media\/a\.mp4/)
  assert.match(p, /convert done: a\.mp4/)
  assert.ok(p.length < 2500)
  assert.ok(!/Recent jobs/.test(systemPrompt()))
})

test('failed jobs: common errors get a plain reason and the right fix; unknown ones go to the model only when there is one', async () => {
  const { explain, explainByRules, FIXES, RULES } = require('../electron/core/ai/explain.cjs')
  const cases = [
    ["ERROR: [youtube] abc: Sign in to confirm you're not a bot. Use --cookies-from-browser", 'cookies_firefox'],
    ['ERROR: Requested format is not available. Use --list-formats', 'update_ytdlp'],
    ['ERROR: unable to download video data: HTTP Error 403: Forbidden', 'update_ytdlp'],
    ['ERROR: [youtube] abc: Video unavailable. This video is not available in your country', null],
    ['HTTP Error 429: Too Many Requests', 'retry'],
    ['Temporary failure in name resolution', 'retry'],
    ['[h264_nvenc] OpenEncodeSessionEx failed: out of memory (10)', 'cpu_encoder'],
    ['ncnn vkAllocateMemory failed -1000', 'cpu_encoder'],
    ['moov atom not found', null],
    ['Error writing: No space left on device', 'retry'],
    ["spawn ffmpeg ENOENT", null],
  ]
  for (const [text, fix] of cases) {
    const r = explainByRules(text)
    assert.ok(r, text)
    assert.equal(r.fix, fix, text)
    assert.ok(r.reason.length > 20)
  }
  assert.equal(explainByRules('something nobody has seen'), null)
  for (const f of RULES.map((r) => r[2]).filter(Boolean)) assert.ok(FIXES[f], `${f} is a known fix`)
  assert.match((await explain({ kind: 'download', error: 'HTTP Error 429' })).fixLabel, /Try again/)
  assert.equal((await explain({ kind: 'convert', error: 'weird thing' })).source, 'none')
  const ai = { async *chat() { yield { type: 'text', delta: '{"reason":"The input is odd.","fix":"retry"}' } } }
  const viaAi = await explain({ kind: 'convert', error: 'weird thing' }, ['line'], ai)
  assert.deepEqual([viaAi.source, viaAi.fix, viaAi.reason], ['ai', 'retry', 'The input is odd.'])
  const bad = { async *chat() { yield { type: 'text', delta: '{"reason":"x","fix":"rm -rf"}' } } }
  assert.equal((await explain({ kind: 'convert', error: 'weird thing' }, [], bad)).fix, null)
  const rule = await explain({ kind: 'download', error: 'HTTP Error 429' }, [], { async *chat() { throw new Error('must not be asked') } })
  assert.equal(rule.source, 'rule')
})
