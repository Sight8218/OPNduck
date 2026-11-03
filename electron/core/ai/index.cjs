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
 * The AI runtime: which model answers (a local server such as Ollama or LM Studio, another computer, or a cloud API with
 * the person's own key), the settings that shape its answers, and the agent loop that lets it look things up and
 * propose jobs. No Electron. The person's data goes only to the provider they chose; with the provider "off" nothing
 * here does anything.
 */
const { createOpenAiProvider } = require('./providers/openai.cjs')
const { createAnthropicProvider } = require('./providers/anthropic.cjs')
const { createGeminiProvider } = require('./providers/gemini.cjs')
const tools = require('./tools.cjs')

/** The cloud providers: the API family and the address. Model names are never listed here; the provider's own list is fetched. */
const CLOUD = {
  anthropic: { label: 'Anthropic (Claude)', family: 'anthropic' },
  openai: { label: 'OpenAI', family: 'openai', baseUrl: 'https://api.openai.com/v1' },
  gemini: { label: 'Google (Gemini)', family: 'gemini' },
  mistral: { label: 'Mistral', family: 'openai', baseUrl: 'https://api.mistral.ai/v1' },
  xai: { label: 'xAI (Grok)', family: 'openai', baseUrl: 'https://api.x.ai/v1' },
  deepseek: { label: 'DeepSeek', family: 'openai', baseUrl: 'https://api.deepseek.com/v1' },
  openrouter: { label: 'OpenRouter', family: 'openai', baseUrl: 'https://openrouter.ai/api/v1' },
  groq: { label: 'Groq', family: 'openai', baseUrl: 'https://api.groq.com/openai/v1' },
  custom: { label: 'Custom (OpenAI-compatible address)', family: 'openai' },
}

/** Where the local servers listen by default. */
const LOCAL = {
  ollama: { label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1' },
  lmstudio: { label: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1' },
}

const EFFORT = { low: { maxTokens: 1000 }, medium: { maxTokens: 2000 }, high: { maxTokens: 4000 } }

/** Plain http is fine for this computer and Tailscale addresses; anything else must be https (keys and messages travel there). */
function addressOk(url, { allowPlain = false } = {}) {
  let u
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol === 'https:') return true
  if (u.protocol !== 'http:') return false
  const h = u.hostname
  if (['localhost', '127.0.0.1', '[::1]'].includes(h) || /\.ts\.net$/i.test(h)) return true
  const m = /^100\.(\d+)\./.exec(h)
  if (m && Number(m[1]) >= 64 && Number(m[1]) <= 127) return true
  return allowPlain
}

/**
 * @param {object} deps
 * @param {() => object} deps.getSettings
 * @param {{ get(id: string): string|null }} deps.keys  the API keys, by provider id (`machine` is the other computer's token)
 * @param {object} [deps.usage]  token counter (ai/usage.cjs); cloud use stops at the monthly limit in the settings
 * @param {object} [deps.local]  the bundled model manager (ai/llama.cjs); without it the `local` provider is unavailable
 * @param {typeof fetch} [deps.fetchFn]
 */
function createAi({ getSettings, keys, local = null, usage = null, fetchFn = fetch }) {
  const cfg = () => getSettings().ai

  /** The provider the settings point at, or throws a readable message. */
  function provider() {
    const s = cfg()
    if (s.provider === 'off') throw new Error('AI is turned off. Choose a model in Settings > AI.')
    if (s.provider === 'local') throw new Error('The local model is started on demand')
    if (LOCAL[s.provider]) return createOpenAiProvider({ baseUrl: LOCAL[s.provider].baseUrl, fetchFn })
    if (s.provider === 'machine') {
      if (!s.machineUrl) throw new Error('Enter the address of the other computer in Settings > AI.')
      if (!addressOk(s.machineUrl)) throw new Error('The address must be https, or http over Tailscale or this computer.')
      return createOpenAiProvider({ baseUrl: s.machineUrl, apiKey: keys.get('machine') ?? '', fetchFn })
    }
    if (s.provider === 'cloud') {
      const c = CLOUD[s.cloud]
      if (!c) throw new Error('Choose a cloud provider in Settings > AI.')
      const apiKey = keys.get(s.cloud)
      if (!apiKey) throw new Error(`Add your ${c.label} API key in Settings > AI first.`)
      if (c.family === 'anthropic') return createAnthropicProvider({ apiKey, fetchFn })
      if (c.family === 'gemini') return createGeminiProvider({ apiKey, fetchFn })
      const baseUrl = s.cloud === 'custom' ? s.customUrl : c.baseUrl
      if (!baseUrl || !addressOk(baseUrl)) throw new Error('A custom address must start with https://')
      return createOpenAiProvider({ baseUrl, apiKey, fetchFn })
    }
    throw new Error('Unknown AI provider')
  }

  /** What the settings mean for one request: temperature, reasoning and the token limit. */
  function options(overrides = {}) {
    const s = cfg()
    const reasoning = s.reasoning === 'auto' ? (s.effort === 'low' ? 'off' : 'on') : s.reasoning
    return { temperature: s.temperature, reasoning, effort: s.effort, maxTokens: EFFORT[s.effort].maxTokens, ...overrides }
  }

  async function* rawChat(opts) {
    const s = cfg()
    const model = opts.model ?? (s.provider === 'local' ? s.localModel : s.model)
    if (!model) throw new Error('Choose a model in Settings > AI first.')
    const o = options(opts)
    const messages = s.vision ? opts.messages : opts.messages.map(({ images: _drop, ...m }) => m) // Vision off: images are never sent
    if (s.provider === 'local') {
      if (!local) throw new Error('The local model is not available in this app.')
      // OPNduck's own model: started the first time it is needed, and ejected again when idle.
      const baseUrl = await local.ensureLoaded()
      const meta = local.modelMeta(s.localModel)
      yield* createOpenAiProvider({ baseUrl, fetchFn }).chat({ ...o, model: s.localModel, messages, tools: opts.tools, jsonSchema: opts.jsonSchema, signal: opts.signal, extra: o.reasoning === 'off' ? meta?.noThink : undefined })
      local.touch()
      return
    }
    yield* provider().chat({ ...o, model, messages, tools: opts.tools, jsonSchema: opts.jsonSchema, signal: opts.signal })
  }

  /** The id usage is counted under: the cloud provider's name, or the kind of local provider. */
  const usageId = () => (cfg().provider === 'cloud' ? cfg().cloud : cfg().provider)

  /** An answer from the chosen model. Counts the tokens, and refuses a cloud provider once this month's limit is reached. */
  async function* chat(opts) {
    const s = cfg()
    if (s.provider === 'cloud' && usage && s.monthlyTokenLimit > 0 && usage.tokens(s.cloud) >= s.monthlyTokenLimit) {
      throw new Error(`The monthly limit of ${s.monthlyTokenLimit.toLocaleString('en')} tokens for ${CLOUD[s.cloud]?.label ?? s.cloud} is reached. Raise it in Settings > AI, or wait for next month.`)
    }
    for await (const ev of rawChat(opts)) {
      if (ev.type === 'done' && ev.usage && usage) usage.record(usageId(), ev.usage)
      yield ev
    }
  }

  const models = async () => {
    if (cfg().provider === 'local') return Object.entries(local?.status().catalog ?? {}).map(([id, m]) => ({ id, name: m.label, vision: m.vision }))
    return provider().models()
  }

  /** Is the chosen provider reachable and does it list models? Never throws. */
  async function test() {
    try {
      if (cfg().provider === 'local') {
        const st = local?.status()
        if (!st?.runtime) throw new Error('The AI engine is not installed yet.')
        if (!st.models[cfg().localModel]) throw new Error('The model is not downloaded yet.')
        return { ok: true, models: await models() }
      }
      const list = await models()
      return { ok: true, models: list }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  }

  /** Which of the local servers are running right now, and what they offer. Never throws. */
  async function detect() {
    const out = {}
    for (const [id, l] of Object.entries(LOCAL)) {
      try {
        out[id] = { running: true, models: await createOpenAiProvider({ baseUrl: l.baseUrl, fetchFn }).models({ signal: AbortSignal.timeout(1500) }) }
      } catch {
        out[id] = { running: false, models: [] }
      }
    }
    return out
  }

  /**
   * One turn with tools. The model may look things up (read-only tools run at once, then it continues) and may propose
   * jobs; proposals stop the loop and come back as `proposals` for the person to confirm. At most MAX_CALLS tool calls.
   * `deps` are the lookups for readTool/propose. Returns { message, proposals, usage }.
   */
  async function agent({ messages, deps, system, signal, onEvent = () => {}, jsonSchema }) {
    const history = [...(system ? [{ role: 'system', content: system }] : []), ...messages]
    const defs = tools.definitions()
    const proposals = []
    let calls = 0
    const usage = { input: 0, output: 0 }
    for (let round = 0; round < tools.MAX_CALLS + 1; round++) {
      let final = null
      for await (const ev of chat({ messages: history, tools: defs, jsonSchema, signal })) {
        if (ev.type === 'done') final = ev
        else onEvent(ev)
      }
      if (!final) throw new Error('The model gave no answer.')
      usage.input += final.usage?.input ?? 0
      usage.output += final.usage?.output ?? 0
      const wanted = final.message.tool_calls ?? []
      history.push(final.message)
      if (wanted.length === 0) return { message: final.message, proposals, usage }
      for (const c of wanted) {
        calls++
        let result
        try {
          if (calls > tools.MAX_CALLS) throw Object.assign(new Error(`Too many tool calls in one request (limit ${tools.MAX_CALLS})`), { toolError: true })
          if (tools.isRead(c.name)) result = await tools.readTool(c.name, c.args, deps)
          else {
            const p = tools.propose(c.name, c.args, deps)
            proposals.push(p)
            result = { ok: true, note: 'Proposed to the person. It starts only if they confirm.' }
          }
        } catch (err) {
          if (!err.toolError) throw err
          result = { error: err.message }
        }
        history.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(result) })
        onEvent({ type: 'tool_result', name: c.name, args: c.args, result })
      }
      if (calls > tools.MAX_CALLS) return { message: final.message, proposals, usage }
    }
    return { message: history[history.length - 1], proposals, usage }
  }

  return { provider, chat, models, usage: () => usage?.month() ?? {}, test, detect, agent, options, status: () => ({ provider: cfg().provider, model: cfg().model }), CLOUD, LOCAL }
}

module.exports = { createAi, addressOk, CLOUD, LOCAL, EFFORT }
