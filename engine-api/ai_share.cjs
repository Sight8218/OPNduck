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
 * The AI model of this computer, as offered to paired devices: only while OPNduck's own model, Ollama or LM Studio is
 * chosen (a cloud provider's model would be used with the owner's key, which is never shared). One implementation for the
 * desktop app and the server. No Electron.
 * @param {{ ai: { chat: Function, models: Function }, llama: { status: Function, load: Function, eject: Function }, getSettings: () => { ai: object } }} deps
 */
function createAiShare({ ai, llama, getSettings }) {
  const usable = () => ['local', 'ollama', 'lmstudio'].includes(getSettings().ai.provider)
  return {
    chat: (o) => {
      if (!usable()) throw new Error("This computer shares no AI model: choose OPNduck's own, Ollama or LM Studio in Settings > AI.")
      return ai.chat(o)
    },
    models: async () => (usable() ? ai.models() : []),
    status: () => {
      const s = getSettings().ai
      return { provider: s.provider, model: s.provider === 'local' ? s.localModel : s.model, shared: usable(), local: llama.status() }
    },
    load: () => (getSettings().ai.provider === 'local' ? llama.load() : Promise.resolve()),
    eject: () => llama.eject(),
  }
}

module.exports = { createAiShare }
