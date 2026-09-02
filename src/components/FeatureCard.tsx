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


import type { ReactNode } from 'react'
import type { FeatureDefinition } from '../features/registry'
import { useReduceMotion } from '../lib/motionPrefs'

/**
 * Shared chrome for every adaptive card: glass body, header (icon + title +
 * tagline + scope badge) and a footer. Feature-specific controls render in
 * the body via `children`. The hover lift + glow is purely decorative, so it
 * respects Settings > Appearance > Motion & Density > Reduce motion.
 */
export default function FeatureCard({
  feature,
  children,
}: {
  feature: FeatureDefinition
  children?: ReactNode
}) {
  const { reduceMotion } = useReduceMotion()
  return (
    <section
      className={`glass flex flex-col rounded-3xl p-5 transition-all duration-300 ease-out ${
        reduceMotion ? '' : 'hover:-translate-y-1 hover:shadow-[0_4px_22px_-6px_var(--card-glow)]'
      }`}
      style={{ ['--card-glow' as string]: feature.accent ?? 'var(--card-glow)' }}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="glass flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-lg leading-none">
            <span
              aria-hidden="true"
              className="inline-block select-none"
              style={{ filter: 'grayscale(1) contrast(1.1) brightness(1.3)' }}
            >
              {feature.icon}
            </span>
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

      {children ? <div className="flex flex-col gap-3">{children}</div> : null}
    </section>
  )
}
