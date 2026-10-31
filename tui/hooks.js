import { useEffect, useState } from 'react'
import { useStdout } from 'ink'

/** Re-renders whenever the job core reports a change (task progress, logs, queue state). */
export function useCoreEvents(platform) {
  const [, setN] = useState(0)
  useEffect(() => {
    const offs = ['tasks:update', 'tasks:log', 'queue:state'].map((ch) => platform.on(ch, () => setN((n) => n + 1)))
    return () => offs.forEach((off) => off())
  }, [platform])
}

/** The terminal's width and height, kept current when the window is resized. */
export function useTerminalSize() {
  const { stdout } = useStdout()
  const [size, setSize] = useState(() => ({ cols: stdout?.columns ?? 80, rows: stdout?.rows ?? 24 }))
  useEffect(() => {
    const onResize = () => setSize({ cols: stdout?.columns ?? 80, rows: stdout?.rows ?? 24 })
    stdout?.on('resize', onResize)
    return () => void stdout?.off('resize', onResize)
  }, [stdout])
  return size
}
