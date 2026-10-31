import { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { useTerminalSize } from '../hooks.js'
import { ago, clip, formatBytes } from '../format.js'

const FINAL = ['done', 'error', 'canceled']
const GLYPH = { done: '✓', error: '✗', canceled: '–' }

/** Everything that has finished, newest first, with where the result went. */
export default function Library({ theme, core }) {
  const { engine } = core
  const { cols } = useTerminalSize()
  const [sel, setSel] = useState(0)
  const [msg, setMsg] = useState('')
  const rows = [...engine.tasks.values()]
    .filter((t) => FINAL.includes(t.state.status))
    .sort((a, b) => (b.state.createdAt ?? 0) - (a.state.createdAt ?? 0))
  const cur = rows[Math.min(sel, Math.max(0, rows.length - 1))]

  useInput((input, key) => {
    if (key.upArrow || input === 'k') setSel((v) => Math.max(0, v - 1))
    else if (key.downArrow || input === 'j') setSel((v) => Math.min(Math.max(0, rows.length - 1), v + 1))
    else if (input === 'x') {
      engine.clearFinished()
      setSel(0)
      setMsg('Cleared the history.')
    } else if (!cur) return
    else if (input === 'o') {
      engine.revealTask(cur.state.id)
      setMsg('Opened its folder.')
    }
    else if (input === 'r') setMsg(engine.rerunTask(cur.state.id) ? 'Started again (see the Queue).' : 'Cannot run that again.')
    else if (input === 'd') setMsg(engine.removeTasks([cur.state.id]) ? 'Removed.' : '')
  })

  const labelW = Math.max(16, cols - 50)
  return (
    <Box flexDirection="column">
      <Box flexDirection="column" borderStyle="single" borderColor={theme.dim} paddingX={1}>
        {rows.length === 0 ? <Text color={theme.dim}>Nothing here yet. Finished jobs are kept between launches.</Text> : null}
        {rows.slice(0, 14).map((t) => {
          const s = t.state
          const active = cur && s.id === cur.state.id
          const color = s.status === 'error' ? theme.err : s.status === 'done' ? theme.ok : theme.dim
          return (
            <Box key={s.id} gap={1}>
              <Text color={theme.accent}>{active ? '▶' : ' '}</Text>
              <Text color={color}>{GLYPH[s.status]}</Text>
              <Box width={labelW}>
                <Text color={active ? theme.accent : theme.text}>{clip(s.label || s.kind, labelW)}</Text>
              </Box>
              <Box width={12}>
                <Text color={theme.dim}>{s.kind}</Text>
              </Box>
              <Box width={9}>
                <Text color={theme.dim}>{formatBytes(s.sizeBytes)}</Text>
              </Box>
              <Text color={theme.dim}>{ago(s.createdAt)}</Text>
            </Box>
          )
        })}
      </Box>
      {cur ? (
        <Box flexDirection="column" paddingX={1} marginTop={1}>
          <Text color={theme.dim}>{cur.state.status === 'error' ? `error: ${cur.state.error ?? 'failed'}` : cur.finalPath ? clip(cur.finalPath, cols - 6) : '(no file)'}</Text>
        </Box>
      ) : null}
      <Text color={theme.dim}>{msg}</Text>
    </Box>
  )
}
