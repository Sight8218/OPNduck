/*
 * OPNduck — local-first media processing suite.
 * Copyright (C) 2026 Aaron Jonsson
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Derives OPNduck's full theme token set from a live Omarchy theme's
 * colors.toml, so the "Synced with Omarchy" option (see ThemeToggle) can
 * work for any of Omarchy's ~20 themes — including ones added after this
 * was written — without hand-authoring a preset per theme.
 *
 * Omarchy's colors.toml uses the same flat schema for every theme (accent,
 * a 4-step background ladder, a 4-step foreground ladder, mode, plus ANSI
 * colors) — see the `omarchy` skill's theming.md. Everything below is
 * computed from just those fields, using `color-mix()` for tints so it
 * degrades gracefully for palettes this was never specifically tuned against.
 */

export interface OmarchyTheme {
  /** Theme slug, e.g. "osaka-jade". */
  slug: string
  colors: Record<string, string>
}

/** Relative luminance (0-1) of a #rrggbb hex color, for contrast decisions. */
function luminance(hex: string): number {
  const m = hex.replace('#', '')
  if (m.length !== 6) return 0.5
  const r = parseInt(m.slice(0, 2), 16) / 255
  const g = parseInt(m.slice(2, 4), 16) / 255
  const b = parseInt(m.slice(4, 6), 16) / 255
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/**
 * Builds the same CSS custom-property set tokens.css hand-authors for
 * Blarange/Monochrome, but computed from live Omarchy colors. Applied as
 * inline styles on <html> (see useTheme.ts) — that wins over any stylesheet
 * rule, so no static `[data-theme='omarchy']` block is needed.
 */
export function deriveOmarchyTokens(theme: OmarchyTheme): Record<string, string> {
  const c = theme.colors
  const accent = c.accent || '#e1892f'
  const background = c.background || '#17130f'
  const darkBackground = c.dark_background || background
  const darkerBackground = c.darker_background || darkBackground
  const lighterBackground = c.lighter_background || background
  const foreground = c.foreground || '#ede6d9'
  const darkForeground = c.dark_foreground || foreground
  const isLight = c.mode === 'light'

  // Pick readable button text by measuring the accent itself, rather than
  // assuming every theme's accent is dark-background-friendly the way
  // Blarange's orange and Monochrome's near-white both happen to be.
  const btnText = luminance(accent) > 0.5 ? darkerBackground : foreground

  return {
    '--glass-bg': background,
    '--glass-bg-strong': darkerBackground,
    '--glass-tint': 'transparent',
    '--glass-blur': '0px',
    '--glass-saturate': '1',
    '--glass-border': `color-mix(in srgb, ${accent} 18%, transparent)`,
    '--glass-border-inner': `color-mix(in srgb, ${accent} 25%, transparent)`,
    '--glass-shadow': isLight ? '0 10px 26px -16px rgba(0, 0, 0, 0.35)' : '0 10px 26px -16px rgba(0, 0, 0, 0.85)',
    '--card-glow': `color-mix(in srgb, ${accent} 45%, transparent)`,

    '--input-bg': darkerBackground,
    '--input-bg-hover': darkBackground,
    '--input-border': `color-mix(in srgb, ${accent} 35%, transparent)`,
    '--input-border-focus': accent,
    '--btn-bg': accent,
    '--btn-bg-hover': `color-mix(in srgb, ${accent} 85%, white)`,
    '--btn-text': btnText,

    '--text': foreground,
    '--text-dim': `color-mix(in srgb, ${darkForeground} 80%, ${background})`,
    '--text-faint': `color-mix(in srgb, ${darkForeground} 55%, ${background})`,

    '--accent': accent,
    '--accent-strong': `color-mix(in srgb, ${accent} 85%, white)`,
    '--accent-soft': `color-mix(in srgb, ${accent} 75%, ${background})`,

    '--bg-base': `linear-gradient(180deg, ${lighterBackground} 0%, ${background} 60%, ${darkerBackground} 100%)`,
    '--bg-solid': background,
    '--bg-scrim': 'transparent',
    '--bg-wash': 'transparent',
    '--bg-grad-a': 'linear-gradient(transparent, transparent)',
    '--bg-grad-b': 'linear-gradient(transparent, transparent)',
    '--bg-grad-c': 'linear-gradient(transparent, transparent)',
    '--bg-grad-d': 'linear-gradient(transparent, transparent)',
    '--fluid-1': 'transparent',
    '--fluid-2': 'transparent',
    '--fluid-3': 'transparent',
    '--fluid-4': 'transparent',
    '--fluid-5': 'transparent',
    '--fluid-6': 'transparent',
    '--glass-on': '1',
    '--fluid-on': '0',
    '--grain-on': '0',
  }
}

const TOKEN_KEYS = [
  '--glass-bg', '--glass-bg-strong', '--glass-tint', '--glass-blur', '--glass-saturate',
  '--glass-border', '--glass-border-inner', '--glass-shadow', '--card-glow',
  '--input-bg', '--input-bg-hover', '--input-border', '--input-border-focus',
  '--btn-bg', '--btn-bg-hover', '--btn-text',
  '--text', '--text-dim', '--text-faint',
  '--accent', '--accent-strong', '--accent-soft',
  '--bg-base', '--bg-solid', '--bg-scrim', '--bg-wash',
  '--bg-grad-a', '--bg-grad-b', '--bg-grad-c', '--bg-grad-d',
  '--fluid-1', '--fluid-2', '--fluid-3', '--fluid-4', '--fluid-5', '--fluid-6',
  '--glass-on', '--fluid-on', '--grain-on',
] as const

/** Applies a live Omarchy theme's derived tokens as inline styles on <html> —
 *  inline wins over any stylesheet rule, so no static CSS block is needed. */
export function applyOmarchyTokens(theme: OmarchyTheme): void {
  if (typeof document === 'undefined') return
  const tokens = deriveOmarchyTokens(theme)
  const root = document.documentElement.style
  for (const key of TOKEN_KEYS) root.setProperty(key, tokens[key])
}

/** Removes any inline Omarchy tokens so the static Blarange/Monochrome CSS
 *  block for the newly-selected theme takes full effect again. */
export function clearOmarchyTokens(): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement.style
  for (const key of TOKEN_KEYS) root.removeProperty(key)
}

/** Title-cases an Omarchy slug for display, e.g. "osaka-jade" -> "Osaka Jade". */
export function omarchySlugToLabel(slug: string): string {
  return slug
    .split('-')
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}
