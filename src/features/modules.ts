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


import { registerFeatures } from './registry'
import DownloaderCard from './downloader/DownloaderCard'
import UpscalerCard from './upscaler/UpscalerCard'

/**
 * Registers the core tool cards into the adaptive registry.
 * Called once at app startup; later the plugin loader calls
 * `registerFeatures()` again with community definitions.
 */
export function registerCoreFeatures(): void {
  registerFeatures([
    {
      id: 'downloader',
      title: 'Downloader',
      tagline: 'YouTube · TikTok · SoundCloud · Spotify',
      description:
        'High-speed media downloads with high-quality MP4, MP3, MKV, MOV, FLAC and WAV output.',
      scope: 'universal',
      icon: '⇩',
      accent: 'rgba(255, 145, 0, 0.45)',
      enabled: true,
      render: DownloaderCard,
      source: 'core',
    },
    {
      id: 'upscaler',
      title: 'AI Upscaler',
      tagline: 'Real-ESRGAN · up to 4×',
      description:
        'Rebuild detail and boost resolution up to 4× on your local GPU or CPU.',
      scope: 'desktop-exclusive',
      icon: '⇧',
      accent: 'rgba(255, 107, 107, 0.45)',
      enabled: true,
      render: UpscalerCard,
      source: 'core',
    },
  ])
}