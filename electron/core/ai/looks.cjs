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
 * The AI look picker: from a few frames of a video (or just a description such as "a warm 70s film"), the model returns
 * slider values and a look, nothing else. They are applied by the same filters as the manual sliders, so the person can
 * adjust everything afterwards. Pure helpers plus one function that asks the model. No Electron.
 */

const LOOK_IDS = ['', 'warm_film', 'teal_orange', 'bleach_bypass', 'bw_rich', 'vintage_fade', 'cool_night']

/** The answer shape the model is held to. */
const lookSchema = {
  type: 'object',
  properties: {
    look: { type: 'string', enum: LOOK_IDS },
    intensity: { type: 'number' },
    temperature: { type: 'number' },
    tint: { type: 'number' },
    exposure: { type: 'number' },
    contrast: { type: 'number' },
    saturation: { type: 'number' },
    why: { type: 'string' },
  },
  required: ['look', 'intensity', 'temperature', 'tint', 'exposure', 'contrast', 'saturation', 'why'],
  additionalProperties: false,
}

const RANGES = { temperature: [-1, 1], tint: [-1, 1], exposure: [-2, 2], contrast: [0.5, 1.6], saturation: [0, 2], intensity: [0, 1] }

/** The model's answer made safe: unknown looks dropped, every number held inside its range, `why` kept short. */
function parseLook(text) {
  let j
  try {
    j = JSON.parse(String(text).trim().replace(/^```(?:json)?|```$/g, ''))
  } catch {
    throw new Error('The model did not answer with a look. Try again, or describe it in other words.')
  }
  if (!j || typeof j !== 'object') throw new Error('The model did not answer with a look. Try again, or describe it in other words.')
  const out = { look: LOOK_IDS.includes(j.look) ? j.look : '', why: String(j.why ?? '').slice(0, 300) }
  for (const [k, [lo, hi]] of Object.entries(RANGES)) {
    const n = Number(j[k])
    out[k] = Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : k === 'contrast' || k === 'saturation' ? 1 : k === 'intensity' ? 1 : 0
  }
  return out
}

/**
 * @param {{ chat: Function }} ai  the AI runtime
 * @param {{ frames?: string[], prompt?: string }} input  frames are data: URLs
 */
async function pickLook(ai, { frames = [], prompt = '' }) {
  const ask = String(prompt).slice(0, 300)
  const system = 'You are a colourist. Choose a colour grade for the video. Answer only with the JSON asked for. temperature and tint go from -1 to 1 (positive is warmer and more magenta), exposure from -2 to 2 stops, contrast 0.5 to 1.6, saturation 0 to 2 (1 is unchanged), intensity 0 to 1. Use a look only when it fits, otherwise an empty string. Prefer small changes.'
  const content = ask ? `Make it look like this: ${ask}` : 'Look at these frames and choose a grade that improves them without changing their character.'
  let text = ''
  for await (const ev of ai.chat({ messages: [{ role: 'system', content: system }, { role: 'user', content, images: frames.slice(0, 4) }], jsonSchema: lookSchema, temperature: 0.2, reasoning: 'off', maxTokens: 400 })) if (ev.type === 'text') text += ev.delta
  return parseLook(text)
}

module.exports = { lookSchema, parseLook, pickLook, LOOK_IDS }
