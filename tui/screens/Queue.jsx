import { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import ProgressBar from '../ui/ProgressBar.jsx'
import { useTerminalSize } from '../hooks.js'

const GLYPH = { queued: '·', running: '●', done: '✓', error: '✗', canceled: '–' }
const FINAL = ['done', 'error', 'canceled']

/** Newest work first: running, then waiting, then finished (most recent on top). */
function ordered(tasks) {
  const rank = (s) => (s.status === 'running' ? 0 : s.status === 'queued' ? 1 : 2)
  return [...tasks.values()].map((t) => t.state).sort((a, b) => rank(a) - rank(b) || (b.createdAt ?? 0) - (a.createdAt ?? 0))
}

const clip = (text, n) => (text.length > n ? text.slice(0, Math.max(1, n - 1)) + '…' : text)

/** The job list with live progress, and the keys that act on the selected job. */
export default function Queue({ theme, core }) {
  const { engine } = core
  const { cols } = useTerminalSize()
  const [sel, setSel] = useState(0)
  const [showLog, setShowLog] = useState(false)
  const [msg, setMsg] = useState('')
  const rows = ordered(engine.tasks)
  const cur = rows[Math.min(sel, Math.max(0, rows.length - 1))]
  const paused = engine.queuePaused

  useInput((input, key) => {
    if (key.upArrow || input === 'k') setSel((v) => Math.max(0, v - 1))
    else if (key.downArrow || input === 'j') setSel((v) => Math.min(Math.max(0, rows.length - 1), v + 1))
    else if (input === 'p') {
      engine.setQueuePaused(!paused)
      setMsg(!paused ? 'Queue paused: running jobs finish, waiting ones do not start.' : 'Queue resumed.')
    } else if (!cur) return
    else if (input === 'c') setMsg(engine.cancelTask(cur.id) ? 'Canceled.' : 'That job already finished.')
    else if (input === 'n') setMsg(engine.allPools.some((p) => p.prioritize(cur.id)) ? 'Moved to the front of its line.' : 'Only a waiting job can run next.')
    else if (input === 'r') setMsg(engine.rerunTask(cur.id) ? 'Started again.' : 'Cannot run that again.')
    else if (input === 'd') setMsg(engine.removeTasks([cur.id]) ? 'Removed.' : 'Only a finished job can be removed.')
    else if (input === 'x') {
      engine.clearFinished()
      setSel(0)
      setMsg('Cleared finished jobs.')
    } else if (input === 'l') setShowLog((v) => !v)
    else if (input === 'o') {
      engine.revealTask(cur.id)
      setMsg('Opened its folder.')
    }
  })

  const barW = Math.max(8, Math.min(30, cols - 62))
  const labelW = Math.max(14, cols - barW - 39)
  const logLines = cur ? (engine.tasks.get(cur.id)?.log?.lines ?? []).slice(-6) : []

  return (
    <Box flexDirection="column">
      {paused ? <Text color={theme.accent}>Queue paused</Text> : null}
      <Box flexDirection="column" borderStyle="single" borderColor={theme.dim} paddingX={1}>
        {rows.length === 0 ? <Text color={theme.dim}>No jobs yet. Start one from a tool, or pass --start.</Text> : null}
        {rows.slice(0, 14).map((s) => {
          const active = cur && s.id === cur.id
          const color = s.status === 'error' ? theme.err : s.status === 'done' ? theme.ok : active ? theme.accent : theme.text
          return (
            <Box key={s.id} gap={1}>
              <Text color={theme.accent}>{active ? '▶' : ' '}</Text>
              <Text color={color}>{GLYPH[s.status] ?? '?'}</Text>
              <Box width={labelW}>
                <Text color={active ? theme.accent : theme.text}>{clip(s.label || s.kind, labelW)}</Text>
              </Box>
              <Box width={12}>
                <Text color={theme.dim}>{s.kind}</Text>
              </Box>
              {FINAL.includes(s.status) ? (
                <Box width={barW + 5}>
                  <Text color={color}>{s.status === 'error' ? clip(s.error ?? 'failed', barW + 4) : s.status}</Text>
                </Box>
              ) : (
                <>
                  <ProgressBar value={s.progress ?? 0} width={barW} color={theme.accent} dim={theme.dim} />
                  <Text color={theme.text}>{String(Math.round((s.progress ?? 0) * 100)).padStart(3)}%</Text>
                </>
              )}
            </Box>
          )
        })}
      </Box>
      {showLog && cur ? (
        <Box flexDirection="column" paddingX={1} marginTop={1}>
          <Text color={theme.dim}>log: {clip(cur.label || cur.kind, cols - 10)}</Text>
          {logLines.length === 0 ? <Text color={theme.dim}>(nothing yet)</Text> : logLines.map((l, i) => <Text key={i} color={theme.dim}>{clip(l, cols - 4)}</Text>)}
        </Box>
      ) : null}
      <Text color={theme.dim}>{msg}</Text>
    </Box>
  )
}
