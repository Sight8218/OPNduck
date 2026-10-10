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
import ConverterCard from './converter/ConverterCard'
import DownloaderCard from './downloader/DownloaderCard'
import InterpolationCard from './interpolate/InterpolationCard'
import ImageUpscalerCard from './upscaler/ImageUpscalerCard'
import VideoUpscalerCard from './upscaler/VideoUpscalerCard'

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
      tagline: 'YouTube · TikTok · SoundCloud',
      description: 'Fast downloads in MP4, MP3, MKV, MOV, FLAC or WAV. Spotify links get YouTube-matched (experimental).',
      scope: 'universal',
      icon: 'download',
      enabled: true,
      render: DownloaderCard,
      source: 'core',
    },
    {
      id: 'converter',
      title: 'Converter',
      tagline: 'MP4 · MKV · WebM · MOV',
      description: 'Batch remux or transcode between containers — no re-encode when it isn’t needed.',
      scope: 'universal',
      icon: 'convert',
      enabled: true,
      render: ConverterCard,
      source: 'core',
    },
    {
      id: 'image-upscaler',
      title: 'AI Image Upscaler',
      tagline: 'Real-ESRGAN · up to 4×',
      description: 'Boost still-image resolution up to 4× on your local GPU.',
      scope: 'desktop-exclusive',
      icon: 'image-upscale',
      enabled: true,
      render: ImageUpscalerCard,
      source: 'core',
    },
    {
      id: 'video-upscaler',
      title: 'AI Video Upscaler',
      tagline: 'Real-ESRGAN · up to 4×',
      description: 'Boost video resolution up to 4×, frame by frame. Slow but genuinely per-frame AI, not a filter.',
      scope: 'desktop-exclusive',
      icon: 'video-upscale',
      enabled: true,
      render: VideoUpscalerCard,
      source: 'core',
    },
    {
      id: 'frame-interpolation',
      title: 'Frame Interpolation',
      tagline: 'RIFE · smoother motion',
      description: 'Generates real in-between frames to raise a video’s frame rate 2× or 4×.',
      scope: 'desktop-exclusive',
      icon: 'interpolate',
      enabled: true,
      render: InterpolationCard,
      source: 'core',
    },
  ])
}