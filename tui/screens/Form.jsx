import fs from 'node:fs'
import { useEffect, useMemo, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { argsFromPluginForm, buildForm, buildPluginForm, requestFromForm } from '../forms.js'
import { absolutePath, completePath, parseTime } from '../paths.js'

const TEXT_KINDS = ['path', 'text', 'number', 'time']
const display = (f, v) => (f.kind === 'choice' ? String(f.options[v ?? f.index]) : f.kind === 'toggle' ? (v ? 'yes' : 'no') : (v ?? ''))

/** A tool's screen: its options as a form, generated from the job definition. Enter on "Start" runs the job. */
export default function Form({ theme, core, tool, onStarted, onBack, onTyping }) {
  const form = useMemo(() => (tool.def ? buildPluginForm(tool.def) : buildForm(tool.id)), [tool])
  const [result, setResult] = useState('')
  const [focus, setFocus] = useState(0)
  const [values, setValues] = useState(() => Object.fromEntries(form.fields.map((f) => [f.key, f.kind === 'choice' ? f.index : f.value])))
  const [error, setError] = useState('')
  const [hints, setHints] = useState([])
  const rows = form.fields.length + 1 // the last row is the Start button
  const f = form.fields[focus]
  const typing = !!f && TEXT_KINDS.includes(f.kind)

  useEffect(() => {
    onTyping(typing)
    return () => onTyping(false)
  }, [typing, onTyping])

  const set = (key, v) => setValues((s) => ({ ...s, [key]: v }))

  function start() {
    const helpers = { exists: (p) => fs.existsSync(p), toAbsolute: absolutePath, parseTime }
    if (tool.def) {
      // A plugin tool is not a job: it answers with a result, shown under the form.
      const r = argsFromPluginForm(form, values, helpers)
      if (r.error) return setError(r.error)
      setError('')
      setResult('Running…')
      Promise.resolve(core.plugins.callTool(tool.def.name, r.args)).then(
        (out) => setResult(JSON.stringify(out ?? null, null, 2).slice(0, 4000)),
        (err) => (setResult(''), setError(err.message)),
      )
      return
    }
    const res = requestFromForm(form, values, helpers)
    if (res.error) return setError(res.error)
    Promise.resolve(core.startJob(res.channel, res.req)).then(
      () => onStarted(`${tool.title}: started.`),
      (err) => setError(err.message),
    )
  }

  useInput((input, key) => {
    if (key.escape) return onBack()
    if (key.upArrow) return (setError(''), setHints([]), setFocus((v) => (v + rows - 1) % rows))
    if (key.downArrow) return (setError(''), setHints([]), setFocus((v) => (v + 1) % rows))
    if (key.return) {
      if (focus === rows - 1) return start()
      return setFocus((v) => v + 1)
    }
    if (!f) return
    if (f.kind === 'choice' && (key.leftArrow || key.rightArrow || input === ' ')) {
      const cur = values[f.key] ?? f.index
      set(f.key, (cur + (key.leftArrow ? f.options.length - 1 : 1)) % f.options.length)
    } else if (f.kind === 'toggle' && (key.leftArrow || key.rightArrow || input === ' ')) {
      set(f.key, !values[f.key])
    } else if (typing) {
      const cur = String(values[f.key] ?? '')
      if (key.tab && f.kind === 'path') {
        const r = completePath(cur)
        set(f.key, r.text)
        setHints(r.candidates.length > 1 ? [...r.candidates, ...(r.more ? [`… ${r.more} more`] : [])] : [])
      } else if (key.backspace || key.delete) set(f.key, cur.slice(0, -1))
      else if (key.ctrl && input === 'u') set(f.key, '')
      else if (key.ctrl && input === 'w') set(f.key, cur.replace(/\S+\s*$/, ''))
      else if (input && !key.ctrl && !key.meta && !key.tab) {
        set(f.key, cur + input.replace(/[\r\n]/g, ''))
        setHints([])
      }
    }
  })

  return (
    <Box flexDirection="column">
      <Text color={theme.accent} bold>
        {tool.title} <Text color={theme.dim}>{tool.tagline}</Text>
      </Text>
      <Box flexDirection="column" borderStyle="single" borderColor={theme.dim} paddingX={1} marginTop={1}>
        {form.fields.map((field, n) => {
          const active = n === focus
          const v = display(field, values[field.key])
          return (
            <Box key={field.key} gap={1}>
              <Text color={active ? theme.accent : theme.dim}>{active ? '▶' : ' '}</Text>
              <Box width={22}>
                <Text color={active ? theme.accent : theme.text}>{field.label}{field.required ? ' *' : ''}</Text>
              </Box>
              {field.kind === 'choice' || field.kind === 'toggle' ? (
                <Text color={active ? theme.accent : theme.text}>{active ? `‹ ${v} ›` : v}</Text>
              ) : (
                <Text color={theme.text}>
                  {v}
                  {active ? <Text color={theme.accent}>▏</Text> : null}
                </Text>
              )}
            </Box>
          )
        })}
        <Box gap={1} marginTop={1}>
          <Text color={focus === rows - 1 ? theme.accent : theme.dim}>{focus === rows - 1 ? '▶' : ' '}</Text>
          <Text color={focus === rows - 1 ? theme.accent : theme.text} inverse={focus === rows - 1} bold>
            {' Start '}
          </Text>
        </Box>
      </Box>
      {hints.length ? (
        <Box flexDirection="column" paddingX={1}>
          {hints.map((h) => (
            <Text key={h} color={theme.dim}>{h}</Text>
          ))}
        </Box>
      ) : null}
      {result ? (
        <Box paddingX={1} marginTop={1}>
          <Text color={theme.text}>{result}</Text>
        </Box>
      ) : null}
      <Box paddingX={1}>
        {error ? <Text color={theme.err}>{error}</Text> : <Text color={theme.dim}>{f?.help ?? 'Enter to start.'}</Text>}
      </Box>
    </Box>
  )
}
