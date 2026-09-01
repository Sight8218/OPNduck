import { useState } from 'react'
import FeatureCard from '../../components/FeatureCard'
import GlassSelect from '../../components/GlassSelect'
import type { FeatureDefinition } from '../registry'

const FORMAT_OPTIONS = ['MP4', 'MP3', 'MKV', 'MOV', 'FLAC', 'WAV'].map((f) => ({
  value: f,
  label: f,
}))

export default function DownloaderCard({ feature }: { feature: FeatureDefinition }) {
  const [url, setUrl] = useState('')
  const [format, setFormat] = useState('MP4')

  return (
    <FeatureCard feature={feature}>
      <input
        className="glass-input"
        type="url"
        placeholder="Paste a YouTube, TikTok, SoundCloud or Spotify link…"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      <div>
        <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-[var(--text-dim)]">
          Format
        </span>
        <GlassSelect
          id="downloader-format"
          options={FORMAT_OPTIONS}
          value={format}
          onChange={setFormat}
        />
      </div>
      <button className="glass-btn" disabled={!url.trim()}>
        Run Task
      </button>
    </FeatureCard>
  )
}