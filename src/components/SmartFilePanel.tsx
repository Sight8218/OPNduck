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

import { useState } from 'react'
import GlassSelect from './GlassSelect'
import { host, type ContainerFormat, type ConvertMode } from '../host'
import { getDownloadDirOverride } from '../lib/downloadPrefs'
import { IconArrowsExchange } from '@tabler/icons-react'

const CONTAINER_OPTIONS: { value: ContainerFormat; label: string }[] = [
  { value: 'MP4', label: 'MP4' },
  { value: 'MKV', label: 'MKV' },
  { value: 'WEBM', label: 'WebM' },
  { value: 'MOV', label: 'MOV' },
]
const MODE_OPTIONS: { value: ConvertMode; label: string }[] = [
  { value: 'remux', label: 'Remux (fast, no re-encode)' },
  { value: 'transcode', label: 'Transcode (re-encode)' },
]

function basename(fullPath: string): string {
  return fullPath.split(/[/\\]/).pop() ?? fullPath
}

/** The command palette's "you pasted a media file path" quick action —
 *  Convert always works; Upscale is offered for video but isn't wired up yet
 *  (AI Upscaler has no real backend), so it explains itself instead of doing
 *  nothing or silently failing. Audio files never get an Upscale option at
 *  all — there's nothing to upscale in an audio-only file. */
// @category: palette/smart-detection
export default function SmartFilePanel({
  path,
  kind,
  onDone,
}: {
  path: string
  kind: 'video' | 'audio'
  onDone: () => void
}) {
  const [container, setContainer] = useState<ContainerFormat>('MP4')
  const [mode, setMode] = useState<ConvertMode>('remux')
  const [upscaleNote, setUpscaleNote] = useState(false)

  async function convert() {
    await host.tasks.startConvert({
      inputPath: path,
      container,
      mode,
      destination: getDownloadDirOverride() ?? undefined,
    })
    onDone()
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2 text-xs text-[var(--text-dim)]">
        <IconArrowsExchange size={14} aria-hidden="true" />
        <span className="truncate">{basename(path)}</span>
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-[var(--glass-border)] p-3">
        <span className="text-xs font-semibold text-[var(--text)]">Convert</span>
        <div className="grid grid-cols-2 gap-3">
          <GlassSelect id="palette-cv-container" options={CONTAINER_OPTIONS} value={container} onChange={setContainer} />
          <GlassSelect id="palette-cv-mode" options={MODE_OPTIONS} value={mode} onChange={setMode} />
        </div>
        <button type="button" className="glass-btn" onClick={convert}>
          Convert
        </button>
      </div>

      {kind === 'video' && (
        <div className="flex flex-col gap-2 rounded-xl border border-[var(--glass-border)] p-3">
          <span className="text-xs font-semibold text-[var(--text)]">Upscale</span>
          {upscaleNote ? (
            <p className="text-xs text-[var(--text-dim)]">
              Upscaling isn't ready yet — sorry for the inconvenience!
            </p>
          ) : (
            <button type="button" className="glass-btn" onClick={() => setUpscaleNote(true)}>
              Upscale
            </button>
          )}
        </div>
      )}
    </div>
  )
}
