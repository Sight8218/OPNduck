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
/**
 * The OpenAI chat-completions format, which most providers speak: OpenAI itself, Ollama, LM Studio, llama.cpp's
 * server, xAI, DeepSeek, Mistral, OpenRouter, Groq and any custom address. Only the base address and key differ.
 * Plain fetch, no SDK.
 */
const { readSse, describeError } = require('../sse.cjs')

/**
 * @param {object} cfg
 * @param {string} cfg.baseUrl  such as http://127.0.0.1:1234/v1
 * @param {string} [cfg.apiKey]
 * @param {typeof fetch} [cfg.fetchFn]
 * @param {Record<string,string>} [cfg.headers]
 */
function createOpenAiProvider({ baseUrl, apiKey = '', fetchFn = fetch, headers = {} }) {
  const root = baseUrl.replace(/\/+$/, '')
  const auth = () => ({ ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), ...headers })

  /** Our messages (text, or text plus images) in the shape this API takes. */
  function wire(messages) {
    return messages.map((m) => {
      if (m.role === 'tool') return { role: 'tool', tool_call_id: m.tool_call_id, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }
      if (m.role === 'assistant' && m.tool_calls?.length) return { role: 'assistant', content: m.content || null, tool_calls: m.tool_calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) } })) }
      if (Array.isArray(m.images) && m.images.length) return { role: m.role, content: [{ type: 'text', text: m.content ?? '' }, ...m.images.map((url) => ({ type: 'image_url', image_url: { url } }))] }
      return { role: m.role, content: m.content ?? '' }
    })
  }

  async function* chat({ model, messages, tools, jsonSchema, temperature, maxTokens, signal, reasoning, extra }) {
    const body = {
      model,
      messages: wire(messages),
      stream: true,
      stream_options: { include_usage: true },
      ...(temperature != null ? { temperature } : {}),
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
      ...(tools?.length ? { tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) } : {}),
      ...(jsonSchema ? { response_format: { type: 'json_schema', json_schema: { name: 'answer', strict: true, schema: jsonSchema } } } : {}),
      ...(reasoning === 'off' ? { reasoning_effort: 'none' } : {}),
      ...extra,
    }
    let res
    try {
      res = await fetchFn(`${root}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify(body), signal })
    } catch (err) {
      if (signal?.aborted) throw err
      throw new Error(`Cannot reach ${root}. Is it running?`)
    }
    if (!res.ok) throw new Error(await describeError(res))
    let text = ''
    let usage = null
    const calls = new Map() // index -> { id, name, args }
    for await (const ev of readSse(res)) {
      if (ev.data === '[DONE]') break
      let j
      try {
        j = JSON.parse(ev.data)
      } catch {
        continue
      }
      if (j.error) throw new Error(typeof j.error === 'string' ? j.error : j.error.message ?? 'The model reported an error')
      if (j.usage) usage = { input: j.usage.prompt_tokens ?? 0, output: j.usage.completion_tokens ?? 0 }
      const d = j.choices?.[0]?.delta
      if (!d) continue
      const think = d.reasoning_content ?? d.reasoning
      if (think) yield { type: 'thinking', delta: think }
      if (d.content) {
        text += d.content
        yield { type: 'text', delta: d.content }
      }
      for (const c of d.tool_calls ?? []) {
        const cur = calls.get(c.index ?? 0) ?? { id: '', name: '', args: '' }
        if (c.id) cur.id = c.id
        if (c.function?.name) cur.name += c.function.name
        if (c.function?.arguments) cur.args += c.function.arguments
        calls.set(c.index ?? 0, cur)
      }
    }
    const toolCalls = [...calls.values()].filter((c) => c.name).map((c, i) => {
      let args = {}
      try {
        args = c.args ? JSON.parse(c.args) : {}
      } catch {
        args = { _unparsed: c.args }
      }
      return { id: c.id || `call_${i}`, name: c.name, args }
    })
    for (const c of toolCalls) yield { type: 'tool_call', ...c }
    yield { type: 'done', message: { role: 'assistant', content: text, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }, usage }
  }

  /** The models this address offers: [{ id, vision?, size? }]. Ollama and LM Studio add detail through their own endpoints. */
  async function models({ signal } = {}) {
    let res
    try {
      res = await fetchFn(`${root}/models`, { headers: auth(), signal: signal ?? AbortSignal.timeout(6000) })
    } catch {
      throw new Error(`Cannot reach ${root}. Is it running?`)
    }
    if (!res.ok) throw new Error(await describeError(res))
    const j = await res.json()
    return (j.data ?? []).map((m) => ({ id: String(m.id), name: m.name ?? String(m.id) }))
  }

  return { kind: 'openai', baseUrl: root, chat, models }
}

module.exports = { createOpenAiProvider }
