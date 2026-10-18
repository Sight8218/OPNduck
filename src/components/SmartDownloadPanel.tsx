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

import { useEffect, useState } from 'react'
import GlassSelect from './GlassSelect'
import { host, type AudioQuality, type DownloadFormat, type PlaylistInfo, type VideoQuality } from '../host'
import {
  AUDIO_QUALITY_OPTIONS,
  FORMAT_OPTIONS,
  VIDEO_FORMATS,
  VIDEO_QUALITY_OPTIONS,
} from '../features/downloader/options'
import { initialPrefs } from '../lib/smartMode'
import { getDownloadDirOverride } from '../lib/downloadPrefs'
import { IconDownload } from '@tabler/icons-react'

/** The command palette's "you pasted a link" quick action — same controls as
 *  the Downloader card, condensed for an inline popup instead of a full card. */
// @category: palette/smart-detection
export default function SmartDownloadPanel({ url, onDone }: { url: string; onDone: () => void }) {
  const [start] = useState(initialPrefs) // Smart Mode: begin with the last-used setup
  const [format, setFormat] = useState<DownloadFormat>(start.format)
  const [videoQuality, setVideoQuality] = useState<VideoQuality>(start.videoQuality)
  const [audioQuality, setAudioQuality] = useState<AudioQuality>(start.audioQuality)
  const isVideo = VIDEO_FORMATS.includes(format)
  const [playlist, setPlaylist] = useState<PlaylistInfo | null>(null)
  const [playlistMode, setPlaylistMode] = useState<'single' | 'all'>('single')
  const [checking, setChecking] = useState(true)
  const [startError, setStartError] = useState<string | null>(null)

  // Same link check the Downloader card does, so a pasted playlist link isn't
  // silently reduced to one video.
  useEffect(() => {
    let stale = false
    setChecking(true)
    setPlaylistMode('single')
    host.tasks
      .probe({ url, format: 'MP4' })
      .then((r) => {
        if (stale) return
        setPlaylist(r.playlist ?? null)
        setChecking(false)
      })
      .catch(() => {
        if (!stale) setChecking(false) // link check failed — still allow a plain download
      })
    return () => {
      stale = true
    }
  }, [url])
  const wholePlaylist = !!playlist && playlist.count > 0 && (!playlist.ambiguous || playlistMode === 'all')
  const needsLogin = !!playlist?.needsLogin

  async function run() {
    try {
      await host.tasks.startDownload({
      url,
      format,
      videoQuality: isVideo ? videoQuality : undefined,
      audioQuality: format === 'MP3' ? audioQuality : undefined,
      destination: getDownloadDirOverride() ?? undefined,
      playlist: playlistMode,
      })
    } catch (err) {
      setStartError(err instanceof Error ? err.message : String(err))
      return
    }
    onDone()
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2 text-xs text-[var(--text-dim)]">
        <IconDownload size={14} aria-hidden="true" />
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
      {playlist && (
        <div>
          {playlist.ambiguous ? (
            <>
              <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Playlist link</span>
              <GlassSelect
                id="palette-dl-playlist-mode"
                options={[
                  { value: 'single' as const, label: 'Just this video' },
                  { value: 'all' as const, label: `Entire playlist (${playlist.count} videos)` },
                ]}
                value={playlistMode}
                onChange={setPlaylistMode}
              />
            </>
          ) : (
            <span className="text-xs text-[var(--text-dim)]">
              {needsLogin
                ? 'This list needs you to be signed in — set a cookie source in Settings → Downloads.'
                : `${playlist.type === 'channel' ? 'Channel' : playlist.type === 'search' ? 'Search results' : 'Playlist'}: ${playlist.title} — ${playlist.count} videos`}
            </span>
          )}
        </div>
      )}
      {startError && <span className="text-xs text-red-400">{startError}</span>}
      <button type="button" className="glass-btn" onClick={run} disabled={checking || needsLogin}>
        {checking ? 'Checking link…' : wholePlaylist ? 'Download playlist' : 'Download'}
      </button>
    </div>
  )
}
