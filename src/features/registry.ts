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
  /** Icon key — resolved to an SVG by components/featureIcons.tsx. */
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
 * A plugin's plugin.json — the on-disk, author-facing format. Locked down now
 * so plugin authors have a stable target to build against; the loader that
 * reads this from disk and turns it into a registered FeatureDefinition
 * arrives with the Tauri desktop shell (see PLUGINS.md for why). `entry`'s
 * default export must match FeatureDefinition['render']'s signature exactly:
 * `(props: { feature: FeatureDefinition }) => JSX.Element`.
 */
export interface PluginManifest {
  /** Unique, kebab-case — e.g. "waveform-preview". Becomes FeatureDefinition.id. */
  id: string
  name: string
  version: string
  author: string
  description: string
  tagline: string
  /** Emoji-free icon key, same convention as FeatureDefinition.icon. */
  icon: string
  /** Optional CSS color (e.g. "rgba(120, 190, 255, 0.45)") for the hover glow. */
  accent?: string
  scope: FeatureScope
  /** Path to the entry file, relative to the plugin's own folder — e.g. "index.js". */
  entry: string
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
