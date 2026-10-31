import { Text } from 'ink'

/** A square-block progress bar: `value` is 0..1. */
export default function ProgressBar({ value, width, color, dim }) {
  const w = Math.max(4, width)
  const filled = Math.round(Math.min(1, Math.max(0, value)) * w)
  return (
    <Text>
      <Text color={color}>{'█'.repeat(filled)}</Text>
      <Text color={dim}>{'░'.repeat(w - filled)}</Text>
    </Text>
  )
}
