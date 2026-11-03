/*
 * OPNduck — local-first media processing suite.
 * Copyright (C) 2026 Aaron Jonsson. GPL-3.0-or-later; see LICENSE.
 *
 * AI evals: runs OPNduck's real prompts against a model and checks the answers for the things that matter (valid
 * shape, no invented facts, nothing outside its range). Use it when you change a prompt or try a new model:
 *   AI_EVAL_URL=http://127.0.0.1:1234/v1 AI_EVAL_MODEL=<model id> npm run ai:eval
 * Works with any OpenAI-compatible server (LM Studio, Ollama's /v1, llama.cpp). Exits 1 if any case fails.
 */
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createOpenAiProvider } = require('../electron/core/ai/providers/openai.cjs')
const video = require('../electron/core/ai/video.cjs')
const { pickLook, LOOK_IDS } = require('../electron/core/ai/looks.cjs')
const { pickThumbnail: _unused, parsePick } = require('../electron/core/ai/thumbnail.cjs')

const baseUrl = process.env.AI_EVAL_URL
const model = process.env.AI_EVAL_MODEL
if (!baseUrl || !model) {
  console.error('Set AI_EVAL_URL (for example http://127.0.0.1:1234/v1) and AI_EVAL_MODEL.')
  process.exit(2)
}
const provider = createOpenAiProvider({ baseUrl })
const ai = { chat: (o) => provider.chat({ model, reasoning: 'off', maxTokens: 700, ...o }) }

const transcript = {
  duration: 300,
  segments: [
    [0, 'Welcome back. Today we make a simple potato soup.'],
    [20, 'First peel four potatoes and two carrots.'],
    [60, 'Cut everything into small cubes and put it in the pot with water.'],
    [110, 'Let it boil for twenty minutes until the potatoes are soft.'],
    [170, 'Now blend half of the soup and stir it back in.'],
    [220, 'Season with salt, pepper and a little cream.'],
    [270, 'That is all. Thanks for watching and see you next time.'],
  ].map(([start, text]) => ({ start, end: start + 15, text })),
}

const cases = [
  ['summary stays on topic and short', async () => {
    const s = await video.summarize(ai, transcript)
    if (!/soup|potato/i.test(s.summary)) throw new Error(`off topic: ${s.summary}`)
    if (s.points.length < 1 || s.points.length > 7) throw new Error(`${s.points.length} points`)
    if (/pizza|chicken|beef/i.test(JSON.stringify(s))) throw new Error('invented an ingredient')
  }],
  ['chapters are sorted, start at 0:00 and stay inside the video', async () => {
    const c = await video.proposeChapters(ai, transcript)
    if (!c.length || c[0].start !== 0) throw new Error(`first chapter at ${c[0]?.start}`)
    for (let i = 1; i < c.length; i++) if (c[i].start <= c[i - 1].start || c[i].start > 300) throw new Error('out of order or past the end')
  }],
  ['an answer quotes a time and does not invent', async () => {
    let out = ''
    for await (const ev of video.ask(ai, transcript, 'How long should the soup boil?')) if (ev.type === 'text') out += ev.delta
    if (!/twenty|20/.test(out)) throw new Error(`missed the answer: ${out}`)
    if (!/\[\d+:\d{2}\]/.test(out)) throw new Error('no time in brackets')
    out = ''
    for await (const ev of video.ask(ai, transcript, 'What is the capital of France?')) if (ev.type === 'text') out += ev.delta
    if (/\bParis\b/.test(out) && !/cannot|can't|not say|does not/i.test(out)) throw new Error(`answered from outside the transcript: ${out}`)
  }],
  ['a grade look is a known look and every number is in range', async () => {
    const l = await pickLook(ai, { prompt: 'warm and a bit faded, like an old holiday film' })
    if (!LOOK_IDS.includes(l.look)) throw new Error(`unknown look ${l.look}`)
    if (Math.abs(l.temperature) > 1 || l.exposure < -2 || l.exposure > 2 || l.saturation < 0 || l.saturation > 2) throw new Error('out of range')
  }],
  ['a thumbnail choice is a frame number, never a path', async () => {
    let text = ''
    for await (const ev of ai.chat({ messages: [{ role: 'system', content: 'Choose frame 1, 2 or 3. Answer only with JSON {"pick": number, "why": string}.' }, { role: 'user', content: 'Frame 2 is the sharpest.' }], jsonSchema: require('../electron/core/ai/thumbnail.cjs').pickSchema })) if (ev.type === 'text') text += ev.delta
    if (!parsePick(text, 3)) throw new Error(`unusable: ${text}`)
  }],
]

let failed = 0
for (const [name, fn] of cases) {
  const t = Date.now()
  try {
    await fn()
    console.log(`ok    ${name} (${((Date.now() - t) / 1000).toFixed(1)} s)`)
  } catch (err) {
    failed++
    console.log(`FAIL  ${name}: ${err.message}`)
  }
}
console.log(failed ? `${failed} of ${cases.length} failed` : `all ${cases.length} passed`)
process.exit(failed ? 1 : 0)
