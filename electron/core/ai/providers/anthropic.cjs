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
 * Anthropic's Messages API (Claude), streaming, with tools, images, extended thinking and structured JSON answers.
 * Plain fetch, no SDK.
 */
const { readSse, describeError } = require('../sse.cjs')

const VERSION = '2023-06-01'

/** "data:image/png;base64,AAAA" -> an Anthropic image block. */
function imageBlock(url) {
  const m = /^data:(image\/[\w+.-]+);base64,(.+)$/.exec(url)
  if (!m) throw new Error('Images must be sent as data: URLs')
  return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } }
}

/** Our messages as Anthropic's: the system text is separate, tool results are user turns, and consecutive same-role turns are merged. */
function wire(messages) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
  const out = []
  const push = (role, blocks) => {
    const last = out[out.length - 1]
    if (last && last.role === role) last.content.push(...blocks)
    else out.push({ role, content: [...blocks] })
  }
  for (const m of messages) {
    if (m.role === 'system') continue
    if (m.role === 'tool') push('user', [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }])
    else if (m.role === 'assistant') {
      const blocks = []
      if (m.content) blocks.push({ type: 'text', text: m.content })
      for (const c of m.tool_calls ?? []) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args ?? {} })
      push('assistant', blocks.length ? blocks : [{ type: 'text', text: '…' }])
    } else push('user', [...(m.images ?? []).map(imageBlock), { type: 'text', text: m.content ?? '' }])
  }
  return { system, messages: out }
}

function createAnthropicProvider({ apiKey, baseUrl = 'https://api.anthropic.com', fetchFn = fetch }) {
  const root = baseUrl.replace(/\/+$/, '')
  const headers = () => ({ 'x-api-key': apiKey, 'anthropic-version': VERSION, 'Content-Type': 'application/json' })

  async function* chat({ model, messages, tools, jsonSchema, temperature, maxTokens, signal, reasoning, effort }) {
    const { system, messages: msgs } = wire(messages)
    const thinking = reasoning === 'on' ? Math.max(1024, { low: 1024, medium: 2048, high: 4096 }[effort] ?? 2048) : 0
    const answerTool = jsonSchema ? { name: 'answer', description: 'Give the answer in this exact shape.', input_schema: jsonSchema } : null
    const body = {
      model,
      max_tokens: Math.max(maxTokens ?? 2048, thinking ? thinking + 512 : 0),
      stream: true,
      messages: msgs,
      ...(system ? { system } : {}),
      // With thinking on, the temperature must stay at its default.
      ...(temperature != null && !thinking ? { temperature: Math.min(1, temperature) } : {}),
      ...(thinking ? { thinking: { type: 'enabled', budget_tokens: thinking } } : {}),
      ...(tools?.length || answerTool ? { tools: [...(tools ?? []).map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })), ...(answerTool ? [answerTool] : [])] } : {}),
      ...(answerTool && !thinking ? { tool_choice: { type: 'tool', name: 'answer' } } : {}),
    }
    let res
    try {
      res = await fetchFn(`${root}/v1/messages`, { method: 'POST', headers: headers(), body: JSON.stringify(body), signal })
    } catch (err) {
      if (signal?.aborted) throw err
      throw new Error('Cannot reach api.anthropic.com. Check your connection.')
    }
    if (!res.ok) throw new Error(await describeError(res))
    let text = ''
    const usage = { input: 0, output: 0 }
    const blocks = new Map() // index -> { type, id, name, json }
    const toolCalls = []
    for await (const ev of readSse(res)) {
      let j
      try {
        j = JSON.parse(ev.data)
      } catch {
        continue
      }
      if (j.type === 'error') throw new Error(j.error?.message ?? 'The API reported an error')
      if (j.type === 'message_start') usage.input = j.message?.usage?.input_tokens ?? 0
      if (j.type === 'message_delta') usage.output = j.usage?.output_tokens ?? usage.output
      if (j.type === 'content_block_start') blocks.set(j.index, { type: j.content_block.type, id: j.content_block.id, name: j.content_block.name, json: '' })
      if (j.type === 'content_block_delta') {
        const d = j.delta
        if (d.type === 'text_delta') {
          text += d.text
          yield { type: 'text', delta: d.text }
        } else if (d.type === 'thinking_delta') yield { type: 'thinking', delta: d.thinking }
        else if (d.type === 'input_json_delta') blocks.get(j.index).json += d.partial_json
      }
      if (j.type === 'content_block_stop') {
        const b = blocks.get(j.index)
        if (b?.type === 'tool_use') {
          let args = {}
          try {
            args = b.json ? JSON.parse(b.json) : {}
          } catch {
            args = { _unparsed: b.json }
          }
          if (b.name === 'answer' && answerTool) {
            text += JSON.stringify(args)
            yield { type: 'text', delta: JSON.stringify(args) }
          } else toolCalls.push({ id: b.id, name: b.name, args })
        }
      }
    }
    for (const c of toolCalls) yield { type: 'tool_call', ...c }
    yield { type: 'done', message: { role: 'assistant', content: text, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }, usage }
  }

  async function models({ signal } = {}) {
    let res
    try {
      res = await fetchFn(`${root}/v1/models?limit=100`, { headers: headers(), signal: signal ?? AbortSignal.timeout(8000) })
    } catch {
      throw new Error('Cannot reach api.anthropic.com. Check your connection.')
    }
    if (!res.ok) throw new Error(await describeError(res))
    return ((await res.json()).data ?? []).map((m) => ({ id: m.id, name: m.display_name ?? m.id, vision: true }))
  }

  return { kind: 'anthropic', baseUrl: root, chat, models }
}

module.exports = { createAnthropicProvider, wire }
