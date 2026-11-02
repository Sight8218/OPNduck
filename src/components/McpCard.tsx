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
import { useCallback, useEffect, useState } from 'react'
import { host, type McpInfo } from '../host'

// @category: settings/mcp
/** Settings > MCP server: lets Claude Code (or any MCP client) start and watch OPNduck jobs. Off by default. */
export default function McpCard() {
  const [info, setInfo] = useState<McpInfo | null>(null)
  const [copied, setCopied] = useState(false)
  const [clientIndex, setClientIndex] = useState(0)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => host.mcp?.info().then(setInfo), [])
  useEffect(() => {
    void refresh()
  }, [refresh])

  async function toggle(enabled: boolean) {
    setBusy(true)
    try {
      await host.settings?.set({ mcpServer: enabled })
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function reset() {
    setBusy(true)
    try {
      setInfo(await host.mcp!.resetToken())
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!info) return
    try {
      await navigator.clipboard.writeText(client.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard may be blocked; the command is still shown to select by hand */
    }
  }

  if (!info) return null
  const client = info.clients[Math.min(clientIndex, info.clients.length - 1)]
  return (
    <div className="glass rounded-3xl p-5">
      <h2 className="mb-1 text-base font-bold">MCP server</h2>
      <p className="mb-2 text-xs text-[var(--text-dim)]">
        Let any AI app that supports MCP (Claude Code, Codex, Gemini CLI, Cursor, Claude Desktop, LM Studio and more) download, convert, upscale, trim, compress, tag and subtitle files through OPNduck, and watch the jobs.
      </p>
      <label className="flex cursor-pointer items-start gap-3 py-2">
        <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={info.enabled} disabled={busy} onChange={(e) => void toggle(e.target.checked)} />
        <span>
          <span className="text-sm font-medium">Turn on the MCP server</span>
          <span className="block text-[11px] text-[var(--text-dim)]">
            Only this computer can connect, and only with a private token. MCP jobs read files you point them at and always save to your download folder. They show a "via MCP" tag in the Library.
          </span>
        </span>
      </label>
      {info.enabled && (
        <div className="flex flex-col gap-2 border-t border-[var(--glass-border)] pt-3">
          <span className="text-xs text-[var(--text-dim)]">
            {info.running ? `Running on 127.0.0.1:${info.port}` : 'Starting…'}. Pick your AI app and add OPNduck to it:
          </span>
          <div className="flex flex-wrap gap-1.5">
            {info.clients.map((c, i) => (
              <button key={c.name} type="button" className={`glass-btn ${i === clientIndex ? 'ring-1 ring-[var(--accent)]' : ''}`} onClick={() => setClientIndex(i)}>
                {c.name}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-[var(--text-faint)]">
            {client.kind === 'command' ? 'Run this in a terminal:' : 'Paste this into the app\'s MCP settings (VS Code calls the key "servers"):'}
          </span>
          <pre className="select-all overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-[var(--input-bg)] p-2 text-[11px] text-[var(--text)]">{client.text}</pre>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="glass-btn" onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy command'}
            </button>
            <button type="button" className="glass-btn" onClick={() => void reset()} disabled={busy}>
              Reset token
            </button>
          </div>
          <span className="text-[11px] text-[var(--text-faint)]">
            OPNduck has to be running for the tools to work. Resetting the token disconnects nothing: clients pick up the new one on their next call.
          </span>
        </div>
      )}
    </div>
  )
}
// --- end: settings/mcp ---
