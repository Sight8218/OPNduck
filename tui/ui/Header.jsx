import { Box, Text } from 'ink'

/** The top line: wordmark, the screens as tabs, and a running-jobs count. */
export default function Header({ theme, screen, screens, running }) {
  return (
    <Box justifyContent="space-between">
      <Box gap={2}>
        <Text color={theme.accent} bold>
          OPNduck
        </Text>
        {screens.map((s, i) => (
          <Text key={s.id} color={s.id === screen ? theme.accent : theme.dim} inverse={s.id === screen}>
            {` ${i + 1} ${s.label} `}
          </Text>
        ))}
      </Box>
      <Text color={running ? theme.accent : theme.dim}>{running ? `${running} running` : 'idle'}</Text>
    </Box>
  )
}
