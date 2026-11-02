import { useEffect, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { absolutePath, completePath } from '../paths.js'

const clip = (text, n) => (text.length > n ? text.slice(0, Math.max(1, n - 1)) + '…' : text)
const FROM = { url: 'a link', video: 'a video file', audio: 'an audio file', image: 'an image file' }

/** The saved recipes. Enter runs the selected one on a link or file you type; the job shows up in the Queue. */
export default function Recipes({ theme, core, onTyping, onStarted }) {
  const { recipes } = core
  const [list, setList] = useState(() => recipes.list())
  const [sel, setSel] = useState(0)
  const [draft, setDraft] = useState(null) // the link or path being typed, or null
  const [msg, setMsg] = useState('')
  const cur = list[Math.min(sel, Math.max(0, list.length - 1))]

  useEffect(() => {
    onTyping(draft !== null)
    return () => onTyping(false)
  }, [draft, onTyping])

  async function run(input) {
    try {
      const value = cur.input === 'url' ? input.trim() : absolutePath(input.trim())
      await recipes.run(cur.id, value)
      setDraft(null)
      onStarted(`Started “${cur.name}”.`)
    } catch (err) {
      setMsg(err.message)
    }
  }

  useInput((input, key) => {
    if (draft !== null) {
      if (key.escape) return setDraft(null)
      if (key.return) return void run(draft)
      if (key.tab && cur.input !== 'url') {
        const r = completePath(draft)
        setDraft(r.text)
        return
      }
      if (key.backspace || key.delete) return setDraft((d) => d.slice(0, -1))
      if (key.ctrl && input === 'u') return setDraft('')
      if (input && !key.ctrl && !key.meta && !key.tab) setDraft((d) => d + input.replace(/[\r\n]/g, ''))
      return
    }
    if (key.upArrow || input === 'k') return (setMsg(''), setSel((v) => Math.max(0, v - 1)))
    if (key.downArrow || input === 'j') return (setMsg(''), setSel((v) => Math.min(list.length - 1, v + 1)))
    if (!cur) return
    if (key.return) return (setMsg(''), setDraft(''))
    if (input === 'd') {
      if (cur.builtIn) return setMsg('Built-in recipes cannot be removed.')
      recipes.remove(cur.id)
      setList(recipes.list())
      setMsg('Removed.')
    }
  })

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" borderStyle="single" borderColor={theme.dim} paddingX={1}>
        {list.length === 0 ? <Text color={theme.dim}>No recipes yet. Make one in the desktop app.</Text> : null}
        {list.map((r) => {
          const active = cur && r.id === cur.id
          return (
            <Box key={r.id} gap={1}>
              <Text color={theme.accent}>{active ? '▶' : ' '}</Text>
              <Box width={34}>
                <Text color={active ? theme.accent : theme.text}>{clip(r.name, 33)}</Text>
              </Box>
              <Text color={theme.dim}>{clip(`${FROM[r.input]} → ${r.steps.map((s) => s.tool).join(', ')}`, 60)}</Text>
            </Box>
          )
        })}
      </Box>
      {draft !== null && cur ? (
        <Box paddingX={1} marginTop={1}>
          <Text color={theme.accent}>{cur.input === 'url' ? 'Link' : 'File'}: </Text>
          <Text color={theme.text}>{draft}</Text>
          <Text color={theme.accent}>▌</Text>
        </Box>
      ) : null}
      <Text color={theme.dim}>{msg}</Text>
    </Box>
  )
}
