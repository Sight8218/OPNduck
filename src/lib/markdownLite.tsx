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

/**
 * A small, safe renderer for a model's answer: paragraphs, **bold**, `inline code`, bullet and numbered lists, and
 * ``` code blocks. It builds React nodes (never HTML), and links stay plain text, so nothing a model writes can run.
 */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g
  let last = 0
  let i = 0
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index))
    const t = m[0]
    out.push(
      t.startsWith('`') ? (
        <code key={`${keyBase}c${i++}`} className="rounded bg-[var(--input-bg)] px-1 py-0.5 text-[0.92em]">
          {t.slice(1, -1)}
        </code>
      ) : (
        <strong key={`${keyBase}b${i++}`}>{t.slice(2, -2)}</strong>
      ),
    )
    last = m.index! + t.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function renderMarkdown(source: string): ReactNode[] {
  const blocks: ReactNode[] = []
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  let i = 0
  let k = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim().startsWith('```')) {
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) code.push(lines[i++])
      i++ // the closing fence (or the end of a block that was cut off)
      blocks.push(
        <pre key={k++} className="my-2 overflow-x-auto rounded-xl bg-[var(--input-bg)] p-3 text-xs">
          <code>{code.join('\n')}</code>
        </pre>,
      )
    } else if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line)
      const items: ReactNode[] = []
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(<li key={items.length}>{inline(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''), `l${k}${items.length}`)}</li>)
        i++
      }
      blocks.push(ordered ? <ol key={k++} className="my-1 list-decimal pl-5">{items}</ol> : <ul key={k++} className="my-1 list-disc pl-5">{items}</ul>)
    } else if (line.trim() === '') i++
    else {
      const para: string[] = []
      while (i < lines.length && lines[i].trim() !== '' && !lines[i].trim().startsWith('```') && !/^\s*([-*]|\d+\.)\s+/.test(lines[i])) para.push(lines[i++])
      blocks.push(
        <p key={k++} className="my-1 whitespace-pre-wrap">
          {inline(para.join('\n'), `p${k}`)}
        </p>,
      )
    }
  }
  return blocks
}
