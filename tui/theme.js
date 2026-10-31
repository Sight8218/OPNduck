import { OMARCHY_PALETTES } from '../src/themes/omarchyPalettes.ts'

const BUILTIN = {
  blarange: { accent: '#e1892f', text: '#ece8e1', bg: '#131110' },
  monochrome: { accent: '#e8e8e8', text: '#f4f4f4', bg: '#141414' },
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
/** `a` over `b` at `amount` (0..1), as #rrggbb. */
function mix(a, b, amount) {
  const [x, y] = [hex(a), hex(b)]
  return '#' + x.map((v, i) => Math.round(v * amount + y[i] * (1 - amount)).toString(16).padStart(2, '0')).join('')
}

export const themeNames = () => [...Object.keys(BUILTIN), ...Object.keys(OMARCHY_PALETTES)]

/** Colours for the terminal UI: the accent, text, a dimmer text, and status colours. */
export function makeTheme(name = 'blarange') {
  const pal = OMARCHY_PALETTES[name]
  const base = BUILTIN[name] ?? (pal ? { accent: pal.accent, text: pal.foreground, bg: pal.background } : BUILTIN.blarange)
  return {
    name: BUILTIN[name] || pal ? name : 'blarange',
    accent: base.accent,
    text: base.text,
    dim: mix(base.text, base.bg, 0.62),
    ok: pal?.green ?? '#6a9962',
    err: pal?.red ?? '#e05c48',
  }
}
