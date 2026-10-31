import { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { TOOLS } from '../tools.js'

/** The tool list. Arrow keys move, Enter opens a tool's screen. */
export default function Home({ theme, onOpen, note }) {
  const [i, setI] = useState(0)
  useInput((input, key) => {
    if (key.upArrow || input === 'k') setI((v) => Math.max(0, v - 1))
    if (key.downArrow || input === 'j') setI((v) => Math.min(TOOLS.length - 1, v + 1))
    if (key.return) onOpen(TOOLS[i])
  })
  return (
    <Box flexDirection="column">
      <Box flexDirection="column" borderStyle="single" borderColor={theme.dim} paddingX={1}>
        {TOOLS.map((t, n) => (
          <Box key={t.id} gap={2}>
            <Text color={n === i ? theme.accent : theme.dim}>{n === i ? '▶' : ' '}</Text>
            <Box width={22}>
              <Text color={n === i ? theme.accent : theme.text} bold={n === i}>
                {t.title}
              </Text>
            </Box>
            <Text color={theme.dim}>{t.tagline}</Text>
          </Box>
        ))}
      </Box>
      {note ? <Text color={theme.dim}>{note}</Text> : null}
    </Box>
  )
}
