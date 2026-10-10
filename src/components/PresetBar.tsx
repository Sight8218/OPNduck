import { useState } from 'react'
import { IconPlus, IconX } from '@tabler/icons-react'
import type { Preset } from '../lib/usePresets'

/** Row of saved-preset chips (click to apply, × to delete) plus an inline "save current" box. */
export default function PresetBar<T>({
  presets,
  onApply,
  onSave,
  onRemove,
  applyHint = 'Apply preset',
}: {
  presets: Preset<T>[]
  onApply: (value: T) => void
  onSave?: (name: string) => void
  onRemove: (name: string) => void
  applyHint?: string
}) {
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')

  const commit = () => {
    if (name.trim()) onSave?.(name)
    setName('')
    setNaming(false)
  }

  if (presets.length === 0 && !onSave) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-[var(--text-dim)]">Presets</span>
      {presets.map((p) => (
        <span
          key={p.name}
          className="flex items-center rounded-full border border-[var(--glass-border)] bg-[var(--input-bg)]"
        >
          <button
            type="button"
            title={applyHint}
            className="px-2 py-0.5 font-medium text-[var(--text)] hover:text-[var(--accent)]"
            onClick={() => onApply(p.value)}
          >
            {p.name}
          </button>
          <button
            type="button"
            aria-label={`Delete preset ${p.name}`}
            className="pr-1.5 text-[var(--text-faint)] hover:text-[var(--text)]"
            onClick={() => onRemove(p.name)}
          >
            <IconX size={12} aria-hidden="true" />
          </button>
        </span>
      ))}
      {onSave &&
        (naming ? (
          <input
            autoFocus
            className="glass-input w-32 px-2 py-0.5 text-xs"
            placeholder="Preset name…"
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') {
                setName('')
                setNaming(false)
              }
            }}
            onBlur={commit}
          />
        ) : (
          <button
            type="button"
            className="flex items-center gap-1 rounded-full border border-dashed border-[var(--glass-border)] px-2 py-0.5 text-[var(--text-dim)] hover:text-[var(--text)]"
            onClick={() => setNaming(true)}
          >
            <IconPlus size={12} aria-hidden="true" />
            Save current
          </button>
        ))}
    </div>
  )
}
