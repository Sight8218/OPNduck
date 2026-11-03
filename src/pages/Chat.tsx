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

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import ProgressBar from '../components/ProgressBar'
import { host, type AiProposal, type AiSettings, type Chat, type ChatMessage } from '../host'
import { TITLES } from '../features/recipes/chain'
import { renderMarkdown } from '../lib/markdownLite'
import { useTasks } from '../lib/useTasks'

const clean = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
const basename = (p: string) => p.split(/[/\\]/).pop() ?? p
const newChat = (): Chat => ({ id: crypto.randomUUID(), title: 'New chat', updatedAt: Date.now(), messages: [] })
const shortValue = (v: unknown) => (typeof v === 'string' ? (v.length > 60 ? `…${v.slice(-57)}` : v) : JSON.stringify(v))

/** A job the assistant proposes: what it would do, with Run and Dismiss. Nothing starts until Run. */
function PlanCard({ p, started, onRun, onDismiss, dismissed }: { p: AiProposal; started: string | null; onRun: () => Promise<void>; onDismiss: () => void; dismissed: boolean }) {
  const tasks = useTasks()
  const task = started ? tasks.find((t) => t.id === started) : null
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <div className="glass flex flex-col gap-2 rounded-2xl p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold">{TITLES[p.tool] ?? p.tool.replace(/_/g, ' ')}</span>
        {task && <span className="text-xs text-[var(--text-dim)]">{task.status}</span>}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        {Object.entries(p.args).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-[var(--text-dim)]">{k}</dt>
            <dd className="truncate" title={String(v)}>
              {shortValue(v)}
            </dd>
          </div>
        ))}
      </dl>
      {task && <ProgressBar value={task.progress} status={task.status} />}
      {task?.status === 'error' && <span className="text-xs text-red-400">{task.error}</span>}
      {error && <span className="text-xs text-red-400">{error}</span>}
      {!started && !dismissed && (
        <div className="flex gap-2">
          <button
            type="button"
            className="glass-btn px-3 py-1 text-xs"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              setError('')
              onRun().catch((e) => setError(clean(e))).finally(() => setBusy(false))
            }}
          >
            {busy ? 'Starting…' : 'Run'}
          </button>
          <button type="button" className="glass-btn px-3 py-1 text-xs" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      )}
      {dismissed && !started && <span className="text-xs text-[var(--text-dim)]">Dismissed</span>}
    </div>
  )
}

function Bubble({ m, onRun, onDismiss, dismissed }: { m: ChatMessage; onRun: (i: number) => Promise<void>; onDismiss: (i: number) => void; dismissed: boolean[] }) {
  if (m.role === 'user') {
    return (
      <div className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl bg-[var(--accent)] px-3 py-2 text-sm text-[var(--btn-text)]">{m.content}</div>
    )
  }
  return (
    <div className="flex max-w-[92%] flex-col gap-2 text-sm">
      {m.thinking && (
        <details className="text-xs text-[var(--text-dim)]">
          <summary className="cursor-pointer">Thinking…</summary>
          <p className="mt-1 whitespace-pre-wrap">{m.thinking}</p>
        </details>
      )}
      {m.tools
        ?.filter((t) => !(t.result as { note?: string } | null)?.note) // a job it proposed shows as a card below, not as a look-up
        .map((t, i) => (
        <details key={i} className="text-xs text-[var(--text-dim)]">
          <summary className="cursor-pointer">{(t.result as { error?: string } | null)?.error ? `Could not use ${t.name}: ${(t.result as { error: string }).error}` : `Looked up: ${t.name}`}</summary>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap">{JSON.stringify(t.result, null, 2)}</pre>
        </details>
        ))}
      {m.content && <div>{renderMarkdown(m.content)}</div>}
      {m.proposals?.map((p, i) => (
        <PlanCard key={i} p={p} started={m.started?.[i] ?? null} dismissed={!!dismissed[i]} onRun={() => onRun(i)} onDismiss={() => onDismiss(i)} />
      ))}
    </div>
  )
}

// @category: chat/page
/** The Chat page: talk to the assistant, see its look-ups, and run the jobs it proposes with one click each. */
export default function ChatPage() {
  const [ai, setAi] = useState<AiSettings | null>(null)
  const [chats, setChats] = useState<Omit<Chat, 'messages'>[]>([])
  const [chat, setChat] = useState<Chat>(newChat)
  const [input, setInput] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const [live, setLive] = useState<ChatMessage | null>(null)
  const [request, setRequest] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [dismissed, setDismissed] = useState<Record<number, boolean[]>>({})
  const bottom = useRef<HTMLDivElement>(null)
  const chatRef = useRef(chat)
  chatRef.current = chat

  const refresh = useCallback(() => void host.ai.chats.list().then(setChats), [])
  useEffect(() => {
    void host.settings?.get().then((s) => setAi(s.ai))
    refresh()
  }, [refresh])

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [chat.messages.length, live?.content, live?.thinking])

  // Progress of the answer being written.
  useEffect(
    () =>
      host.ai.onEvent(({ requestId, event }) => {
        setLive((cur) => {
          if (!cur || requestId !== request) return cur
          if (event.type === 'text') return { ...cur, content: cur.content + event.delta }
          if (event.type === 'thinking') return { ...cur, thinking: (cur.thinking ?? '') + event.delta }
          if (event.type === 'tool_result') return { ...cur, tools: [...(cur.tools ?? []), { name: event.name, args: event.args, result: event.result }] }
          return cur
        })
      }),
    [request],
  )

  const persist = useCallback((c: Chat) => {
    void host.ai.chats.save({ id: c.id, title: c.title, messages: c.messages }).then(refresh)
  }, [refresh])

  async function send() {
    const text = input.trim()
    if ((!text && files.length === 0) || request) return
    const content = files.length ? `${text}\n\n${files.map((f) => `[file: ${f}]`).join('\n')}`.trim() : text
    const user: ChatMessage = { role: 'user', content }
    const messages = [...chat.messages, user]
    const title = chat.messages.length === 0 ? (text || basename(files[0])).slice(0, 50) : chat.title
    setChat({ ...chat, title, messages })
    setInput('')
    setFiles([])
    setError('')
    const requestId = crypto.randomUUID()
    setRequest(requestId)
    setLive({ role: 'assistant', content: '' })
    try {
      const r = await host.ai.send({ requestId, messages: messages.map((m) => ({ role: m.role, content: m.content })) })
      const mine = chatRef.current
      setLive((cur) => {
        const reply: ChatMessage = { role: 'assistant', content: r.message, thinking: cur?.thinking, tools: cur?.tools, proposals: r.proposals.length ? r.proposals : undefined, started: r.proposals.map(() => null) }
        const next = { ...mine, messages: r.aborted && !r.message ? mine.messages : [...mine.messages, reply] }
        setChat(next)
        persist(next)
        return null
      })
    } catch (err) {
      setError(clean(err))
      setLive(null)
    } finally {
      setRequest(null)
    }
  }

  async function run(msgIndex: number, i: number) {
    const forChat = chat.id
    const { id } = await host.ai.run(chat.messages[msgIndex].proposals![i])
    // Read the conversation again after the wait: an answer may have arrived meanwhile, and the person may have switched chats.
    const now = chatRef.current
    if (now.id !== forChat) return
    const started = [...(now.messages[msgIndex].started ?? [])]
    started[i] = id
    const next = { ...now, messages: now.messages.map((x, n) => (n === msgIndex ? { ...x, started } : x)) }
    setChat(next)
    persist(next)
  }

  async function open(id: string) {
    const c = await host.ai.chats.get(id)
    if (c) (setChat(c), setDismissed({}))
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    } else if (e.key === 'Escape' && request) void host.ai.abort(request)
  }

  const off = ai?.provider === 'off'
  return (
    <div className="mx-auto mt-16 flex h-[calc(100vh-16rem)] w-full max-w-6xl gap-4 px-4 pb-4">
      <aside className="glass hidden w-56 shrink-0 flex-col gap-2 rounded-3xl p-3 md:flex">
        <button type="button" className="glass-btn px-3 py-1.5 text-xs" onClick={() => (setChat(newChat()), setDismissed({}))}>
          New chat
        </button>
        <div className="flex flex-1 flex-col gap-1 overflow-y-auto">
          {chats.map((c) => (
            <div key={c.id} className={`group flex items-center gap-1 rounded-xl px-2 py-1 text-xs ${c.id === chat.id ? 'bg-[var(--input-bg)]' : ''}`}>
              <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => void open(c.id)}>
                {c.title}
              </button>
              <button type="button" aria-label={`Delete ${c.title}`} className="opacity-0 group-hover:opacity-100" onClick={() => void host.ai.chats.remove(c.id).then(() => (c.id === chat.id && setChat(newChat()), refresh()))}>
                ×
              </button>
            </div>
          ))}
          {chats.length === 0 && <span className="text-[11px] text-[var(--text-dim)]">Conversations are kept on this computer.</span>}
        </div>
        {chats.length > 0 && (
          <button type="button" className="glass-btn px-3 py-1 text-[11px]" onClick={() => void host.ai.chats.removeAll().then(() => (setChat(newChat()), refresh()))}>
            Delete all chats
          </button>
        )}
      </aside>

      <section className="glass flex min-w-0 flex-1 flex-col rounded-3xl">
        <header className="flex items-center justify-between gap-2 border-b border-[var(--glass-border)] px-4 py-2 text-xs text-[var(--text-dim)]">
          <span className="truncate">
            {off ? 'AI is off' : `${ai?.provider === 'cloud' ? '☁ ' : ''}${ai?.model || 'No model chosen'}`}
          </span>
          <Link to="/settings" className="underline">
            AI settings
          </Link>
        </header>
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
          {off && (
            <p className="text-sm text-[var(--text-dim)]">
              The assistant is off. Choose a model in <Link to="/settings" className="underline">Settings, AI</Link>: one on this computer (Ollama or LM Studio), on another computer, or a cloud provider with your own key.
            </p>
          )}
          {!off && chat.messages.length === 0 && (
            <p className="text-sm text-[var(--text-dim)]">Ask for something like "make this video under 25 MB" or "what is still running?". It proposes jobs as cards; nothing starts until you press Run.</p>
          )}
          {chat.messages.map((m, i) => (
            <Bubble key={i} m={m} dismissed={dismissed[i] ?? []} onRun={(p) => run(i, p)} onDismiss={(p) => setDismissed((d) => ({ ...d, [i]: Object.assign([...(d[i] ?? [])], { [p]: true }) }))} />
          ))}
          {live && <Bubble m={live.content || live.thinking || live.tools ? live : { role: 'assistant', content: '…' }} onRun={async () => {}} onDismiss={() => {}} dismissed={[]} />}
          {error && <span className="text-sm text-red-400">{error}</span>}
          <div ref={bottom} />
        </div>
        <footer className="flex flex-col gap-2 border-t border-[var(--glass-border)] p-3">
          {files.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {files.map((f) => (
                <span key={f} className="flex items-center gap-1 rounded-full bg-[var(--input-bg)] px-2 py-0.5 text-[11px]">
                  {basename(f)}
                  <button type="button" aria-label={`Remove ${basename(f)}`} onClick={() => setFiles((x) => x.filter((y) => y !== f))}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <button
              type="button"
              className="glass-btn px-3 py-2 text-xs"
              disabled={off}
              onClick={() => void host.pickFile().then((p) => p && setFiles((x) => [...new Set([...x, p])]))}
            >
              Attach file…
            </button>
            <textarea
              className="glass-input min-h-[2.5rem] flex-1 resize-none"
              rows={2}
              placeholder={off ? 'Turn on the assistant in Settings first' : 'Ask the duck…  (Enter sends, Shift+Enter adds a line)'}
              value={input}
              disabled={off}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              aria-label="Message"
            />
            {request ? (
              <button type="button" className="glass-btn px-4 py-2 text-sm" onClick={() => void host.ai.abort(request)}>
                Stop
              </button>
            ) : (
              <button type="button" className="glass-btn px-4 py-2 text-sm" disabled={off || (!input.trim() && files.length === 0)} onClick={() => void send()}>
                Send
              </button>
            )}
          </div>
        </footer>
      </section>
    </div>
  )
}
// --- end: chat/page ---
