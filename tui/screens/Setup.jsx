import { useCallback, useEffect, useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { clip } from '../format.js'

const empty = { available: false, installHint: '' }

async function readStatus(core) {
  const { tools, modules } = core
  const [ytdlp, torch, demucs, whisper, ffmpeg, esrgan, rife, office] = await Promise.all([
    tools.checkYtDlp().catch(() => empty),
    tools.checkTorchEngine(modules.gpu.torchEngineReady).catch(() => ({ available: false, nvidia: false })),
    tools.checkDemucs().catch(() => empty),
    tools.checkFasterWhisper().catch(() => empty),
    tools.checkFfmpeg().catch(() => empty),
    tools.checkRealesrgan().catch(() => empty),
    tools.checkRife().catch(() => empty),
    tools.checkLibreOffice().catch(() => empty),
  ])
  const gpuWhisper = !!whisper.nvidia
  const rows = [
    { id: 'ytdlp', title: 'Downloader (yt-dlp)', size: 'about 3 MB', step: 'ytdlp', installed: ytdlp.available },
    { id: 'torch', title: 'Fast video engine (PyTorch)', size: 'about 5 GB', step: 'torch', installed: torch.available, blocked: torch.nvidia ? '' : 'needs an NVIDIA GPU' },
    { id: 'demucs', title: 'Audio AI (Demucs)', size: 'about 5 GB', step: 'demucs', installed: demucs.available },
    { id: 'whisper', title: gpuWhisper ? 'Subtitles (faster-whisper, GPU)' : 'Subtitles (faster-whisper)', size: gpuWhisper ? 'about 2.3 GB' : 'about 200 MB', step: gpuWhisper ? 'whisper-gpu' : 'whisper', installed: whisper.available && (!gpuWhisper || !!whisper.gpu) },
  ]
  const system = [
    ['ffmpeg', ffmpeg],
    ['Real-ESRGAN', esrgan],
    ['RIFE', rife],
    ['LibreOffice', office],
  ].filter(([, s]) => !s.available)
  return { rows, system }
}

/** Choose what to install: the same installs as the desktop Setup window. */
export default function Setup({ theme, core, onTyping }) {
  const [data, setData] = useState(null)
  const [focus, setFocus] = useState(0)
  const [picked, setPicked] = useState({})
  const [run, setRun] = useState({})
  const [line, setLine] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const cancelled = useRef(false)

  useEffect(() => {
    onTyping(false)
  }, [onTyping])

  const refresh = useCallback(async () => {
    const d = await readStatus(core)
    setData(d)
    return d
  }, [core])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function install() {
    const chosen = data.rows.filter((r) => picked[r.id] && !r.installed && !r.blocked)
    if (!chosen.length) return setMsg('Tick something to install first (space).')
    cancelled.current = false
    setBusy(true)
    setMsg('')
    setRun(Object.fromEntries(chosen.map((r) => [r.id, 'waiting'])))
    for (const r of chosen) {
      if (cancelled.current) break
      setRun((s) => ({ ...s, [r.id]: 'installing' }))
      setLine('Starting…')
      const res = r.step === 'ytdlp' ? await core.tools.installYtDlp() : await core.tools.installTool(r.step, (l) => setLine(l))
      if (cancelled.current) {
        setRun((s) => ({ ...s, [r.id]: 'failed' }))
        break
      }
      setRun((s) => ({ ...s, [r.id]: res.ok ? 'done' : 'failed' }))
      if (!res.ok) setMsg(`${r.title}: ${res.error ?? 'the install failed.'}`.split('\n')[0])
    }
    setBusy(false)
    setLine('')
    void refresh()
  }

  useInput((input, key) => {
    if (busy) {
      if (input === 'c') {
        cancelled.current = true
        void core.tools.cancelInstall()
        setMsg('Canceling…')
      }
      return
    }
    if (!data) return
    if (key.upArrow || input === 'k') setFocus((v) => Math.max(0, v - 1))
    else if (key.downArrow || input === 'j') setFocus((v) => Math.min(data.rows.length - 1, v + 1))
    else if (input === ' ') {
      const r = data.rows[focus]
      if (r.installed || r.blocked) return setMsg(r.installed ? 'Already installed.' : `Not available: ${r.blocked}.`)
      setPicked((p) => ({ ...p, [r.id]: !p[r.id] }))
    } else if (input === 'i' || key.return) void install()
    else if (input === 'r') {
      setRun({})
      void refresh()
    }
  })

  if (!data) return <Text color={theme.dim}>Checking what you already have…</Text>
  const status = (r) => (run[r.id] === 'installing' ? clip(line, 60) : run[r.id] === 'waiting' ? 'waiting' : run[r.id] === 'done' ? 'installed' : run[r.id] === 'failed' ? 'not installed' : r.installed ? 'installed' : r.blocked || r.size)
  return (
    <Box flexDirection="column">
      <Box flexDirection="column" borderStyle="single" borderColor={theme.dim} paddingX={1}>
        {data.rows.map((r, n) => {
          const active = n === focus
          const mark = r.installed || run[r.id] === 'done' ? '✓' : picked[r.id] ? '■' : '□'
          return (
            <Box key={r.id} gap={1}>
              <Text color={theme.accent}>{active ? '▶' : ' '}</Text>
              <Text color={r.installed ? theme.ok : picked[r.id] ? theme.accent : theme.dim}>{mark}</Text>
              <Box width={34}>
                <Text color={active ? theme.accent : theme.text}>{r.title}</Text>
              </Box>
              <Text color={run[r.id] === 'installing' ? theme.accent : run[r.id] === 'failed' ? theme.err : theme.dim}>{status(r)}</Text>
            </Box>
          )
        })}
      </Box>
      {data.system.length ? (
        <Box flexDirection="column" paddingX={1} marginTop={1}>
          <Text color={theme.text}>From your package manager:</Text>
          {data.system.map(([name, s]) => (
            <Text key={name} color={theme.dim}>
              {name}: {s.installHint}
            </Text>
          ))}
        </Box>
      ) : null}
      <Box paddingX={1}>
        <Text color={theme.dim}>{busy ? 'Installing. Large downloads take a while (c cancels).' : msg}</Text>
      </Box>
    </Box>
  )
}
