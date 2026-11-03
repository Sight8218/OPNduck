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
 * Google's Gemini API, streaming, with function calling, images, thinking and structured JSON answers. Plain fetch.
 */
const { readSse, describeError } = require('../sse.cjs')

/** JSON Schema keywords Gemini's response schema does not take are dropped. */
function schemaFor(s) {
  if (Array.isArray(s)) return s.map(schemaFor)
  if (!s || typeof s !== 'object') return s
  const out = {}
  for (const [k, v] of Object.entries(s)) {
    if (['additionalProperties', '$schema', 'strict', 'default', 'examples'].includes(k)) continue
    out[k] = k === 'properties' ? Object.fromEntries(Object.entries(v).map(([n, p]) => [n, schemaFor(p)])) : schemaFor(v)
  }
  if (Array.isArray(out.type)) out.type = out.type.find((t) => t !== 'null') ?? 'string' // Gemini wants a single type
  return out
}

function wire(messages) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
  const names = new Map() // tool call id -> function name, for the results
  const contents = []
  for (const m of messages) {
    if (m.role === 'system') continue
    if (m.role === 'tool') {
      let response
      try {
        response = typeof m.content === 'string' ? JSON.parse(m.content) : m.content
      } catch {
        response = { result: m.content }
      }
      if (response === null || typeof response !== 'object' || Array.isArray(response)) response = { result: response }
      contents.push({ role: 'user', parts: [{ functionResponse: { name: names.get(m.tool_call_id) ?? 'tool', response } }] })
    } else if (m.role === 'assistant') {
      const parts = []
      if (m.content) parts.push({ text: m.content })
      for (const c of m.tool_calls ?? []) {
        names.set(c.id, c.name)
        parts.push({ functionCall: { name: c.name, args: c.args ?? {} } })
      }
      contents.push({ role: 'model', parts: parts.length ? parts : [{ text: '…' }] })
    } else {
      const parts = (m.images ?? []).map((url) => {
        const x = /^data:(image\/[\w+.-]+);base64,(.+)$/.exec(url)
        if (!x) throw new Error('Images must be sent as data: URLs')
        return { inlineData: { mimeType: x[1], data: x[2] } }
      })
      parts.push({ text: m.content ?? '' })
      contents.push({ role: 'user', parts })
    }
  }
  return { system, contents }
}

function createGeminiProvider({ apiKey, baseUrl = 'https://generativelanguage.googleapis.com', fetchFn = fetch }) {
  const root = baseUrl.replace(/\/+$/, '')
  const headers = () => ({ 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' })

  async function* chat({ model, messages, tools, jsonSchema, temperature, maxTokens, signal, reasoning, effort }) {
    const { system, contents } = wire(messages)
    const budget = reasoning === 'on' ? { low: 512, medium: 1024, high: 4096 }[effort] ?? 1024 : 0
    const body = {
      contents,
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      ...(tools?.length ? { tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: schemaFor(t.parameters) })) }] } : {}),
      generationConfig: {
        ...(temperature != null ? { temperature } : {}),
        ...(maxTokens ? { maxOutputTokens: maxTokens } : {}),
        ...(jsonSchema ? { responseMimeType: 'application/json', responseSchema: schemaFor(jsonSchema) } : {}),
        thinkingConfig: reasoning === 'off' ? { thinkingBudget: 0 } : budget ? { thinkingBudget: budget, includeThoughts: true } : undefined,
      },
    }
    if (body.generationConfig.thinkingConfig === undefined) delete body.generationConfig.thinkingConfig
    let res
    try {
      res = await fetchFn(`${root}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, { method: 'POST', headers: headers(), body: JSON.stringify(body), signal })
    } catch (err) {
      if (signal?.aborted) throw err
      throw new Error('Cannot reach generativelanguage.googleapis.com. Check your connection.')
    }
    if (!res.ok) throw new Error(await describeError(res))
    let text = ''
    let usage = null
    const toolCalls = []
    for await (const ev of readSse(res)) {
      let j
      try {
        j = JSON.parse(ev.data)
      } catch {
        continue
      }
      if (j.error) throw new Error(j.error.message ?? 'The API reported an error')
      if (j.usageMetadata) usage = { input: j.usageMetadata.promptTokenCount ?? 0, output: (j.usageMetadata.candidatesTokenCount ?? 0) + (j.usageMetadata.thoughtsTokenCount ?? 0) }
      for (const p of j.candidates?.[0]?.content?.parts ?? []) {
        if (p.functionCall) toolCalls.push({ id: `call_${toolCalls.length}`, name: p.functionCall.name, args: p.functionCall.args ?? {} })
        else if (p.text) {
          if (p.thought) yield { type: 'thinking', delta: p.text }
          else {
            text += p.text
            yield { type: 'text', delta: p.text }
          }
        }
      }
    }
    for (const c of toolCalls) yield { type: 'tool_call', ...c }
    yield { type: 'done', message: { role: 'assistant', content: text, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }, usage }
  }

  async function models({ signal } = {}) {
    let res
    try {
      res = await fetchFn(`${root}/v1beta/models?pageSize=200`, { headers: headers(), signal: signal ?? AbortSignal.timeout(8000) })
    } catch {
      throw new Error('Cannot reach generativelanguage.googleapis.com. Check your connection.')
    }
    if (!res.ok) throw new Error(await describeError(res))
    return ((await res.json()).models ?? [])
      .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((m) => ({ id: String(m.name).replace(/^models\//, ''), name: m.displayName ?? m.name, vision: true }))
  }

  return { kind: 'gemini', baseUrl: root, chat, models }
}

module.exports = { createGeminiProvider, wire, schemaFor }
