export interface ChipOption {
  value: string
  label: string
}

/** Multi-select as a wrapping row of toggle chips (GlassSelect is single-select only). */
export default function ChipSelect({
  options,
  value,
  onChange,
  disabled,
  max,
}: {
  options: ChipOption[]
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  /** Maximum number of chips that can be selected at once. */
  max?: number
}) {
  const toggle = (v: string) => {
    if (value.includes(v)) onChange(value.filter((x) => x !== v))
    else if (!max || value.length < max) onChange([...value, v])
  }
  return (
    <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
      {options.map((o) => {
        const on = value.includes(o.value)
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            onClick={() => toggle(o.value)}
            className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors disabled:opacity-50 ${
              on
                ? 'border-[var(--input-border-focus)] bg-[var(--input-bg)] text-[var(--accent)]'
                : 'border-[var(--glass-border)] text-[var(--text-dim)] hover:text-[var(--text)]'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
