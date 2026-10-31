import { useEffect, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { themeNames } from '../theme.js'

const ROWS = [
  { key: 'tuiTheme', label: 'Colours', kind: 'choice', options: themeNames(), help: 'The terminal theme. Applies at once.' },
  { key: 'notifyOnFinish', label: 'Notify when done', kind: 'toggle', help: 'A terminal bell and a desktop notification when jobs finish.' },
  { key: 'gpuThreads', label: 'GPU performance', kind: 'choice', options: ['auto', 'low'], help: 'low is gentler on GPUs with little memory.' },
  { key: 'upscaleEngine', label: 'Video upscale engine', kind: 'choice', options: ['auto', 'ncnn'], help: 'auto uses the faster PyTorch engine when it can run.' },
  { key: 'videoEncoder', label: 'AI video encoder', kind: 'choice', options: ['auto', 'cpu'], help: 'auto uses the GPU (NVENC) when it works.' },
  { key: 'maxDownloads', label: 'Parallel downloads', kind: 'number', min: 1, max: 6, help: 'How many downloads run at once (1 to 6).' },
  { key: 'maxConversions', label: 'Parallel conversions', kind: 'number', min: 1, max: 4, help: 'How many conversions run at once (1 to 4).' },
  { key: 'proxy', label: 'Proxy', kind: 'text', help: 'For yt-dlp: http://host:port or socks5://host:port. Enter to edit, empty for none.' },
]

/** The settings shared with the desktop app, saved as you change them. */
export default function Settings({ core, theme, onTheme, onTyping, themeName }) {
  const { settings } = core
  const [values, setValues] = useState(() => settings.getSettings())
  const [focus, setFocus] = useState(0)
  const [draft, setDraft] = useState(null) // text being edited, or null
  const [msg, setMsg] = useState('')
  const row = ROWS[focus]

  useEffect(() => {
    onTyping(draft !== null)
    return () => onTyping(false)
  }, [draft, onTyping])

  function save(patch) {
    try {
      const next = settings.setSettings(patch)
      setValues(next)
      core.engine.applyQueueLimits()
      setMsg('Saved.')
      return true
    } catch (err) {
      setMsg(err.message)
      return false
    }
  }

  useInput((input, key) => {
    if (draft !== null) {
      if (key.escape) return setDraft(null)
      if (key.return) {
        if (save({ [row.key]: draft })) setDraft(null)
        return
      }
      if (key.backspace || key.delete) return setDraft((d) => d.slice(0, -1))
      if (key.ctrl && input === 'u') return setDraft('')
      if (input && !key.ctrl && !key.meta && !key.tab) setDraft((d) => d + input.replace(/[\r\n]/g, ''))
      return
    }
    if (key.upArrow || input === 'k') return (setMsg(''), setFocus((v) => Math.max(0, v - 1)))
    if (key.downArrow || input === 'j') return (setMsg(''), setFocus((v) => Math.min(ROWS.length - 1, v + 1)))
    const step = key.leftArrow ? -1 : key.rightArrow || input === ' ' ? 1 : 0
    if (row.kind === 'text' && key.return) return setDraft(String(values.proxy ?? ''))
    if (!step) return
    if (row.kind === 'toggle') save({ [row.key]: !values[row.key] })
    else if (row.kind === 'choice') {
      const cur = row.options.indexOf(values[row.key])
      const next = row.options[(Math.max(0, cur) + step + row.options.length) % row.options.length]
      if (save({ [row.key]: next }) && row.key === 'tuiTheme') onTheme(next)
    } else if (row.kind === 'number') {
      const n = Math.min(row.max, Math.max(row.min, (values[row.key] ?? row.min) + step))
      save({ [row.key]: n })
    }
  })

  const shown = (r) => {
    const v = r.key === 'tuiTheme' ? themeName : values[r.key]
    if (r.kind === 'toggle') return v ? 'yes' : 'no'
    if (r.kind === 'text') return draft !== null && r === row ? draft : v || '(none)'
    return String(v)
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" borderStyle="single" borderColor={theme.dim} paddingX={1}>
        {ROWS.map((r, n) => {
          const active = n === focus
          return (
            <Box key={r.key} gap={1}>
              <Text color={active ? theme.accent : theme.dim}>{active ? '▶' : ' '}</Text>
              <Box width={24}>
                <Text color={active ? theme.accent : theme.text}>{r.label}</Text>
              </Box>
              <Text color={active ? theme.accent : theme.text}>{active && r.kind !== 'text' ? `‹ ${shown(r)} ›` : shown(r)}{active && draft !== null ? '▏' : ''}</Text>
            </Box>
          )
        })}
      </Box>
      <Box paddingX={1}>
        <Text color={theme.dim}>{msg || row.help}</Text>
      </Box>
    </Box>
  )
}
