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


import { useState, type DragEvent, type ReactNode } from 'react'
import { host } from '../host'
import type { FeatureDefinition } from '../features/registry'
import { useReduceMotion } from '../lib/motionPrefs'
import { FeatureIcon } from './featureIcons'

/**
 * Shared chrome for every adaptive card: glass body, header (icon + title +
 * tagline + scope badge) and a footer. Feature-specific controls render in
 * the body via `children`.
 *
 * The hover glow is intentionally a single flat class, `card-glow-hover`
 * (defined once in index.css against the theme's own --card-glow token) —
 * no per-card CSS variable, no reading `feature.accent` here at all. That
 * field used to drive a per-card inline-style override and, at various
 * points, produced a different glow color per card (hardcoded accents,
 * then a self-referential CSS variable that only accidentally resolved).
 * Removed outright rather than patched again: every card now physically
 * cannot glow anything but the current theme's one color. Purely
 * decorative, so it respects Settings > Appearance > Motion & Density >
 * Reduce motion.
 */
export default function FeatureCard({
  feature,
  children,
  onDropFiles,
  dropExtensions,
  onDropText,
}: {
  feature: FeatureDefinition
  children?: ReactNode
  /** Makes the card a drop target for files from the OS file manager. */
  onDropFiles?: (paths: string[]) => void
  /** Only these extensions (lowercase, no dot) are accepted; others are ignored. */
  dropExtensions?: string[]
  /** Makes the card accept dropped text/links (e.g. a URL dragged from a browser). */
  onDropText?: (text: string) => void
}) {
  const [dragging, setDragging] = useState(false)
  const accepts = (types: readonly string[]) =>
    (!!onDropFiles && types.includes('Files')) ||
    (!!onDropText && (types.includes('text/uri-list') || types.includes('text/plain')))
  const dragProps =
    onDropFiles || onDropText
      ? {
          onDragOver: (e: DragEvent) => {
            if (!accepts(e.dataTransfer.types)) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
            setDragging(true)
          },
          onDragLeave: (e: DragEvent) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
          },
          onDrop: (e: DragEvent) => {
            if (!accepts(e.dataTransfer.types)) return
            e.preventDefault()
            setDragging(false)
            if (onDropFiles && e.dataTransfer.files.length > 0) {
              const paths = Array.from(e.dataTransfer.files)
                .map((f) => host.pathForFile(f))
                .filter(
                  (p) => p && (!dropExtensions || dropExtensions.includes(p.split('.').pop()?.toLowerCase() ?? '')),
                )
              if (paths.length > 0) onDropFiles(paths)
              return
            }
            const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')
            if (onDropText && text) onDropText(text.split('\n')[0].trim())
          },
        }
      : {}

  const { reduceMotion } = useReduceMotion()
  return (
    <section
      className={`glass relative flex h-full flex-col rounded-3xl p-5 transition-[transform,box-shadow] duration-300 ease-out ${
        reduceMotion ? '' : 'card-glow-hover'
      }`}
      {...dragProps}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-3xl border-2 border-dashed border-[var(--accent)] bg-[var(--glass-bg-strong)]/80 text-sm font-bold text-[var(--accent)]">
          {onDropFiles ? 'Drop files to add them' : 'Drop the link here'}
        </div>
      )}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="glass flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-lg leading-none">
            <FeatureIcon name={feature.icon} />
          </div>
          <div>
            <h2 className="text-base font-bold leading-tight">{feature.title}</h2>
            <p className="text-xs text-[var(--text-dim)]">{feature.tagline}</p>
          </div>
        </div>
        <span className="rounded-full border border-[var(--glass-border)] px-2 py-0.5 text-xs font-medium text-[var(--text-dim)]">
          {feature.scope === 'desktop-exclusive' ? 'Desktop' : 'Universal'}
        </span>
      </div>

      <p className="mb-4 text-sm leading-relaxed text-[var(--text-dim)]">{feature.description}</p>

      {children ? (
        // flex-1 + mt-auto on the last child (the action button) pins buttons to the
        // card bottom so cards in the same row line up.
        <div className="flex flex-1 flex-col gap-3 [&>:last-child]:mt-auto">{children}</div>
      ) : null}
    </section>
  )
}
