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

import { IconBolt, IconBrain, IconClipboardList, IconPencil, IconSearch } from '@tabler/icons-react'

/** What the assistant is doing right now. Each phase has its own small animation (CSS, `.ai-*` in index.css). */
export type AiPhase = 'waking' | 'thinking' | 'searching' | 'planning' | 'responding'

const ICONS = { waking: IconBolt, thinking: IconBrain, searching: IconSearch, planning: IconClipboardList, responding: IconPencil }

/** Plain words for the look-ups the assistant can do, so "searching" says what it looks at. */
const LOOKUPS: Record<string, string> = {
  probe_media: 'Looking at the file',
  list_jobs: 'Checking your jobs',
  job_status: 'Checking a job',
  list_recipes: 'Looking at your recipes',
  suggest_settings: 'Working out good settings',
  web_search: 'Searching the web',
  read_page: 'Reading a web page',
  list_settings: 'Looking at the settings',
}
export const isLookup = (tool: string) => tool in LOOKUPS
export const lookupLabel = (tool: string, args: Record<string, unknown> = {}) => {
  if (tool === 'web_search' && typeof args.query === 'string') return `Searching the web for "${args.query.slice(0, 40)}"`
  if (tool === 'read_page' && typeof args.url === 'string') {
    try {
      return `Reading ${new URL(args.url).hostname}`
    } catch {
      /* fall through to the plain words */
    }
  }
  return LOOKUPS[tool] ?? 'Looking something up'
}

const LABELS: Record<AiPhase, string> = { waking: 'Waking the model', thinking: 'Thinking', searching: 'Looking something up', planning: 'Preparing a plan', responding: 'Writing' }

/** A small animated icon and a few words for what the assistant is doing: waking up, thinking, looking something up, planning, writing. */
export default function AiActivity({ phase, label }: { phase: AiPhase; label?: string }) {
  const Glyph = ICONS[phase]
  return (
    <div className="flex items-center gap-2 text-xs text-[var(--text-dim)]" role="status" aria-live="polite">
      <span className={`ai-icon ai-icon-${phase} relative inline-flex h-6 w-6 items-center justify-center`}>
        <Glyph size={18} stroke={1.6} aria-hidden="true" className="ai-glyph" />
        {phase === 'thinking' && (
          <span aria-hidden="true" className="ai-thought">
            <i />
            <i />
            <i />
          </span>
        )}
        {phase === 'responding' && <span aria-hidden="true" className="ai-ink" />}
      </span>
      <span>{label ?? LABELS[phase]}</span>
      <span aria-hidden="true" className="ai-ellipsis">
        <i />
        <i />
        <i />
      </span>
    </div>
  )
}
