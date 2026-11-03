import { useEffect, useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import path from 'node:path'
import os from 'node:os'
import { useTerminalSize } from '../hooks.js'
import { systemPrompt } from '../../electron/core/ai/prompt.cjs'
import { propose } from '../../electron/core/ai/tools.cjs'
import { suggest } from '../../electron/core/autosettings.cjs'

const clip = (text, n) => (text.length > n ? text.slice(0, Math.max(1, n - 1)) + '…' : text)

/** Paths the person typed count as "picked": the assistant may use them. */
function noteTypedFiles(core, text) {
  for (const word of text.split(/\s+/)) {
    const w = word.replace(/^["']|["',.]$/g, '')
    if (w.startsWith('/') || w.startsWith('~/')) core.noteFile(w.startsWith('~/') ? path.join(os.homedir(), w.slice(2)) : w)
  }
}

/** Ask the duck: type a request, read the answer, and run (y) or drop (n) the jobs it proposes. Nothing starts without y. */
export default function Chat({ theme, core, onTyping }) {
  const { cols } = useTerminalSize()
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState([]) // { role, content }
  const [live, setLive] = useState('')
  const [proposals, setProposals] = useState([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const abort = useRef(null)
  const provider = core.settings.getSettings().ai

  useEffect(() => {
    onTyping(!busy && proposals.length === 0)
    return () => onTyping(false)
  }, [busy, proposals.length, onTyping])

  const deps = () => ({
    tasks: core.engine.tasks,
    isKnownFile: core.isKnownFile,
    probeMedia: core.modules.common.probeMedia,
    analyzeMedia: core.modules.analyze.analyzeMedia,
    suggest,
    recipes: core.recipes,
    getRecipe: (id) => core.recipes.get(id),
  })

  async function send(text) {
    noteTypedFiles(core, text)
    const next = [...messages, { role: 'user', content: text }]
    setMessages(next)
    setBusy(true)
    setLive('')
    setProposals([])
    setMsg('')
    abort.current = new AbortController()
    try {
      const jobs = [...core.engine.tasks.values()].slice(-8).map((t) => `${t.state.kind} ${t.state.status}: ${t.state.label}`)
      const r = await core.ai.agent({
        messages: next.slice(-30),
        deps: deps(),
        system: systemPrompt({ files: core.knownFiles(), recentJobs: jobs }),
        signal: abort.current.signal,
        onEvent: (ev) => ev.type === 'text' && setLive((t) => t + ev.delta),
      })
      setMessages([...next, { role: 'assistant', content: r.message.content }])
      setProposals(r.proposals)
    } catch (err) {
      if (!abort.current.signal.aborted) setMsg(err.message)
    } finally {
      setLive('')
      setBusy(false)
    }
  }

  async function runAll() {
    const started = []
    for (const p of proposals) {
      try {
        const q = propose(p.tool, p.args, deps()) // checked again, as in the desktop app
        if (q.tool === 'run_recipe') await core.recipes.run(q.args.recipe, q.args.input)
        else {
          const id = await core.engine.startHandlers.get(q.channel)(null, q.req)
          const e = core.engine.tasks.get(id)
          if (e) e.state.source = 'ai'
        }
        started.push(q.tool)
      } catch (err) {
        setMsg(`${p.tool}: ${err.message}`)
      }
    }
    setProposals([])
    if (started.length) setMsg(`Started: ${started.join(', ')}. See the Queue.`)
  }

  useInput((input, key) => {
    if (busy) {
      if (key.escape) abort.current?.abort()
      return
    }
    if (proposals.length) {
      if (input === 'y') void runAll()
      else if (input === 'n' || key.escape) (setProposals([]), setMsg('Dismissed.'))
      return
    }
    if (key.return) {
      const t = draft.trim()
      if (t) (setDraft(''), void send(t))
      return
    }
    if (key.backspace || key.delete) return setDraft((d) => d.slice(0, -1))
    if (key.ctrl && input === 'u') return setDraft('')
    if (key.escape) return setDraft('')
    if (input && !key.ctrl && !key.meta && !key.tab) setDraft((d) => d + input.replace(/[\r\n]/g, ''))
  })

  const shown = messages.slice(-6)
  return (
    <Box flexDirection="column">
      <Text color={theme.dim}>{provider.provider === 'off' ? 'AI is off. Choose a model in the desktop app (Settings > AI) or in the settings file.' : `${provider.provider === 'cloud' ? 'cloud ' : ''}${provider.provider === 'local' ? provider.localModel : provider.model || 'no model chosen'}`}</Text>
      <Box flexDirection="column" borderStyle="single" borderColor={theme.dim} paddingX={1}>
        {shown.length === 0 && !live ? <Text color={theme.dim}>Ask for something, like "make /path/to/video.mp4 under 25 MB". It proposes jobs; you confirm.</Text> : null}
        {shown.map((m, i) => (
          <Text key={i} color={m.role === 'user' ? theme.accent : theme.text} wrap="wrap">
            {m.role === 'user' ? '> ' : ''}
            {clip(m.content, (cols - 8) * 6)}
          </Text>
        ))}
        {live ? <Text color={theme.text} wrap="wrap">{clip(live, (cols - 8) * 6)}</Text> : null}
        {busy && !live ? <Text color={theme.dim}>thinking… (esc stops)</Text> : null}
      </Box>
      {proposals.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.accent}>The duck suggests:</Text>
          {proposals.map((p, i) => (
            <Text key={i} color={theme.text}>
              {' '}
              {i + 1}. {p.tool} {clip(JSON.stringify(p.args), cols - 12)}
            </Text>
          ))}
          <Text color={theme.dim}>y runs them, n drops them</Text>
        </Box>
      ) : (
        <Box marginTop={1}>
          <Text color={theme.accent}>{'> '}</Text>
          <Text color={theme.text}>{draft}</Text>
          {!busy && <Text color={theme.accent}>▌</Text>}
        </Box>
      )}
      <Text color={theme.dim}>{msg}</Text>
    </Box>
  )
}
