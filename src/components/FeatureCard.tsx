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
import RunOnSelector from './RunOnSelector'

/**
 * Shared chrome for every tool card: glass body, header (icon, title, tagline) and
 * a body for the tool's own controls. The hover glow is the single `card-glow-hover` class, so it
 * always uses the current theme's colour; it is off when Reduce motion is on.
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
        <RunOnSelector featureId={feature.id} />
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
