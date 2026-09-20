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
import { host, type AudioQuality, type DownloadFormat, type VideoQuality } from '../host'
import { getDownloadDirOverride } from '../lib/downloadPrefs'

const FORMAT_OPTIONS = ['MP4', 'MP3', 'MKV', 'MOV', 'FLAC', 'WAV'].map((f) => ({
  value: f as DownloadFormat,
  label: f,
}))
const VIDEO_QUALITY_OPTIONS: { value: VideoQuality; label: string }[] = [
  { value: 'best', label: 'Best available' },
  { value: '2160', label: '2160p (4K)' },
  { value: '1080', label: '1080p' },
  { value: '720', label: '720p' },
  { value: '480', label: '480p' },
  { value: '360', label: '360p' },
]
const AUDIO_QUALITY_OPTIONS: { value: AudioQuality; label: string }[] = [
  { value: 'best', label: 'Best (VBR)' },
  { value: '320k', label: '320 kbps' },
  { value: '192k', label: '192 kbps' },
  { value: '128k', label: '128 kbps' },
]
const VIDEO_FORMATS: DownloadFormat[] = ['MP4', 'MKV', 'MOV']

/** The command palette's "you pasted a link" quick action — same controls as
 *  the Downloader card, condensed for an inline popup instead of a full card. */
// @category: palette/smart-detection
export default function SmartDownloadPanel({ url, onDone }: { url: string; onDone: () => void }) {
  const [format, setFormat] = useState<DownloadFormat>('MP4')
  const [videoQuality, setVideoQuality] = useState<VideoQuality>('best')
  const [audioQuality, setAudioQuality] = useState<AudioQuality>('best')
  const isVideo = VIDEO_FORMATS.includes(format)

  async function run() {
    await host.tasks.startDownload({
      url,
      format,
      videoQuality: isVideo ? videoQuality : undefined,
      audioQuality: format === 'MP3' ? audioQuality : undefined,
      destination: getDownloadDirOverride() ?? undefined,
    })
    onDone()
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2 text-xs text-[var(--text-dim)]">
        <span aria-hidden="true">⇩</span>
        <span className="truncate">{url}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Format</span>
          <GlassSelect id="palette-dl-format" options={FORMAT_OPTIONS} value={format} onChange={setFormat} />
        </div>
        <div>
          {isVideo && (
            <>
              <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Quality</span>
              <GlassSelect
                id="palette-dl-video-quality"
                options={VIDEO_QUALITY_OPTIONS}
                value={videoQuality}
                onChange={setVideoQuality}
              />
            </>
          )}
          {format === 'MP3' && (
            <>
              <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Bitrate</span>
              <GlassSelect
                id="palette-dl-audio-quality"
                options={AUDIO_QUALITY_OPTIONS}
                value={audioQuality}
                onChange={setAudioQuality}
              />
            </>
          )}
          {(format === 'FLAC' || format === 'WAV') && (
            <>
              <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Bitrate</span>
              <div className="glass-input flex items-center text-[var(--text-faint)]">Lossless</div>
            </>
          )}
        </div>
      </div>
      <button type="button" className="glass-btn" onClick={run}>
        Download
      </button>
    </div>
  )
}
