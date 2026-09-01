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


import type { ComponentType } from 'react'

export type FeatureScope = 'universal' | 'desktop-exclusive'

export interface FeatureDefinition {
  id: string
  title: string
  tagline: string
  description: string
  scope: FeatureScope
  /** Emoji-free icon key — resolved to a rendered glyph by the card. */
  icon: string
  /** Optional per-feature glow color used for hover accent tint. */
  accent?: string
  enabled: boolean
  /** Renderless definition of the card component (RSC-safe). */
  render: ComponentType<{ feature: FeatureDefinition }>
  /** Optional flag a future plugin loader flips to inject community cards. */
  source: 'core' | 'plugin'
}

/**
 * Adaptive card registry.
 *
 * The Home grid is generated from this list. Core tools are registered here;
 * when the community plugin system lands, installed plugins append their own
 * FeatureDefinition entries and the grid automatically re-flows — no layout
 * code changes required.
 */
export const featureRegistry: FeatureDefinition[] = []

export function registerFeatures(defs: FeatureDefinition[]): void {
  for (const d of defs) {
    if (!featureRegistry.some((f) => f.id === d.id)) featureRegistry.push(d)
  }
}
