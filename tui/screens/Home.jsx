import { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { TOOLS } from '../tools.js'

/** The tool list. Arrow keys move, Enter opens a tool's screen. */
export default function Home({ theme, onOpen, note, pluginTools = [] }) {
  const items = [...TOOLS, ...pluginTools]
  const [i, setI] = useState(0)
  useInput((input, key) => {
    if (key.upArrow || input === 'k') setI((v) => Math.max(0, v - 1))
    if (key.downArrow || input === 'j') setI((v) => Math.min(items.length - 1, v + 1))
    if (key.return) onOpen(items[i])
  })
  return (
    <Box flexDirection="column">
      <Box flexDirection="column" borderStyle="single" borderColor={theme.dim} paddingX={1}>
        {items.map((t, n) => (
          <Box key={t.id} gap={2}>
            <Text color={n === i ? theme.accent : theme.dim}>{n === i ? '▶' : ' '}</Text>
            <Box width={32}>
              <Text color={n === i ? theme.accent : theme.text} bold={n === i} wrap="truncate-end">
                {t.title}
              </Text>
            </Box>
            <Text color={theme.dim} wrap="truncate-end">{t.tagline}</Text>
          </Box>
        ))}
      </Box>
      {note ? <Text color={theme.dim}>{note}</Text> : null}
    </Box>
  )
}
