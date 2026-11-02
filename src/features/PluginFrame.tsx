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
import { useEffect, useRef, useState } from 'react'
import { host } from '../host'
import type { FeatureDefinition } from './registry'

/** What a plugin card receives next to `feature`: the card-safe host API, already bound to that plugin. */
export interface PluginApi {
  jobs: { start(tool: string, args: object): Promise<string>; list(): Promise<unknown[]>; cancel(id: string): Promise<void> }
  files: { pick(opts?: { save?: boolean; directory?: boolean; filters?: { name: string; extensions: string[] }[] }): Promise<string | null> }
  settings: { get(key: string): Promise<unknown>; set(key: string, value: string | number | boolean): Promise<void> }
  notify(opts: { title?: string; body: string }): Promise<void>
  rpc: { call(name: string, arg?: unknown): Promise<unknown> }
}

interface Props {
  pluginId: string
  version: string
  entry: string
  feature: FeatureDefinition
}

const MIN_HEIGHT = 40
const MAX_HEIGHT = 4000

/** The theme the card should wear: the data-theme attribute and the inline colour variables of the app's root. */
function currentTheme() {
  const el = document.documentElement
  return { dataTheme: el.getAttribute('data-theme') ?? '', style: el.getAttribute('style') ?? '' }
}

/**
 * Runs a plugin card in a sandboxed iframe (no allow-same-origin: it cannot reach this window, its storage
 * or the preload bridge). The only link is postMessage. Calls are answered for THIS plugin id, taken from
 * the props and never from the message, and only the card-safe part of the host API answers them (UI_METHODS).
 */
export default function PluginFrame({ pluginId, version, entry, feature }: Props) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(160)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const post = (message: object) => frame.current?.contentWindow?.postMessage({ opnduckPlugin: 1, ...message }, '*')
    const sendTheme = () => post({ type: 'theme', ...currentTheme() })
    const { id, title, tagline, description, scope, icon, accent } = feature

    const onMessage = (event: MessageEvent) => {
      if (event.source === null || event.source !== frame.current?.contentWindow) return
      const m = event.data as { opnduckPlugin?: number; type?: string; id?: unknown; method?: unknown; args?: unknown; value?: unknown; message?: unknown }
      if (!m || typeof m !== 'object' || m.opnduckPlugin !== 1) return
      if (m.type === 'ready') {
        sendTheme()
        post({ type: 'init', entry, version, feature: { id, title, tagline, description, scope, icon, accent, enabled: true, source: 'plugin' } })
      } else if (m.type === 'height' && typeof m.value === 'number' && Number.isFinite(m.value)) {
        setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(m.value))))
      } else if (m.type === 'error') {
        setError(typeof m.message === 'string' ? m.message.slice(0, 500) : 'The card stopped working.')
      } else if (m.type === 'call' && typeof m.id === 'number' && typeof m.method === 'string') {
        const args = Array.isArray(m.args) ? m.args : []
        host.plugins!.call(pluginId, m.method, args).then(
          (value) => post({ type: 'result', id: m.id, ok: true, value }),
          (err) => post({ type: 'result', id: m.id, ok: false, error: err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '') : String(err) }),
        )
      }
    }
    window.addEventListener('message', onMessage)
    const observer = new MutationObserver(sendTheme)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] })
    return () => {
      window.removeEventListener('message', onMessage)
      observer.disconnect()
    }
  }, [pluginId, version, entry, feature, attempt])

  if (error !== null) {
    return (
      <div className="glass rounded-2xl p-4 text-sm text-[var(--text-dim)]" role="alert">
        <p className="font-semibold text-[var(--text)]">{feature.title} stopped working.</p>
        <p className="mt-1 break-words">{error}</p>
        <button
          type="button"
          className="glass-btn mt-3"
          onClick={() => {
            setError(null)
            setAttempt((n) => n + 1)
          }}
        >
          Try again
        </button>
      </div>
    )
  }
  return (
    <iframe
      key={attempt}
      ref={frame}
      title={feature.title}
      sandbox="allow-scripts"
      src={`opnduck-plugin://${pluginId}/__frame.html`}
      className="block w-full border-0"
      style={{ height, colorScheme: 'normal' }}
    />
  )
}
