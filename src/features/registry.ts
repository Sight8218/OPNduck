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
  /** Set to "plugin" for cards injected by the plugin loader. */
  source: 'core' | 'plugin'
}

export type PluginPermission =
  | 'jobs'
  | 'files:read'
  | 'files:write'
  | 'network'
  | 'exec'
  | 'exec:any'
  | 'settings'
  | 'notify'
  | 'hooks'
  | 'tools'

/**
 * A plugin's plugin.json, the on-disk, author-facing format (apiVersion 1; spec in PLUGINS.md).
 * A v1 manifest (single top-level `entry`, no permissions) is read as `ui: { entry }` with no
 * permissions. The `ui` entry's default export must match FeatureDefinition['render'] exactly:
 * `(props: { feature: FeatureDefinition }) => JSX.Element`.
 */
export interface PluginManifest {
  /** Unique, kebab-case — e.g. "waveform-preview". Becomes FeatureDefinition.id. */
  id: string
  name: string
  version: string
  /** Plugin API version the plugin was written for. Missing = v1 manifest. */
  apiVersion?: number
  author: string
  description: string
  /** Card fields: required when the plugin has a `ui` entry. */
  tagline?: string
  /** Emoji-free icon key, same convention as FeatureDefinition.icon. */
  icon?: string
  /** Optional CSS color (e.g. "rgba(120, 190, 255, 0.45)") for the hover glow. */
  accent?: string
  scope?: FeatureScope
  /** Source repository URL, so users can inspect the code. Required for store listing. */
  repo?: string
  permissions?: PluginPermission[]
  /** Exact hostnames the plugin may contact; used with the `network` permission. */
  network?: string[]
  /** Card entry, path relative to the plugin's own folder — e.g. "index.js". */
  ui?: { entry: string; /** "selector": replaces the tile row on Home (see PLUGINS.md). */ slot?: 'selector' }
  /** Backend entry (CommonJS, runs in a worker), path relative to the plugin's own folder. */
  backend?: { entry: string }
  /** MCP/TUI tool definitions, same shape as electron/mcp_tools.cjs TOOLS. */
  tools?: { name: string; description: string; inputSchema: object }[]
  commands?: { id: string; title: string }[]
  settings?: Record<string, { type: 'string' | 'number' | 'boolean'; title?: string; default?: unknown; enum?: unknown[] }>
  /** v1 only: replaced by `ui.entry`. */
  entry?: string
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

// A fresh array on every change, so React can subscribe to the registry (see useFeatures.ts).
let snapshot: FeatureDefinition[] = []
const listeners = new Set<() => void>()
function changed(): void {
  snapshot = [...featureRegistry]
  listeners.forEach((l) => l())
}

export function registerFeatures(defs: FeatureDefinition[]): void {
  let added = false
  for (const d of defs) {
    if (!featureRegistry.some((f) => f.id === d.id)) {
      featureRegistry.push(d)
      added = true
    }
  }
  if (added) changed()
}

/** Removes a plugin's card (core cards can't be removed). Returns whether anything was removed. */
export function unregisterFeature(id: string): boolean {
  const i = featureRegistry.findIndex((f) => f.id === id && f.source === 'plugin')
  if (i < 0) return false
  featureRegistry.splice(i, 1)
  changed()
  return true
}

export function subscribeFeatures(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getFeatureSnapshot(): FeatureDefinition[] {
  return snapshot
}
