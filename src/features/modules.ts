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
      description:
        'High-speed media downloads with high-quality MP4, MP3, MKV, MOV, FLAC and WAV output. Spotify links (experimental) get matched to the same song on YouTube — Spotify itself is DRM-protected, so this is never a direct Spotify download.',
      scope: 'universal',
      icon: '⇩',
      enabled: true,
      render: DownloaderCard,
      source: 'core',
    },
    {
      id: 'converter',
      title: 'Converter',
      tagline: 'MP4 · MKV · WebM · MOV',
      description:
        'Batch remux or transcode between containers — stream copy when no re-encode is needed, ffmpeg when it is.',
      scope: 'universal',
      icon: '⇄',
      enabled: true,
      render: ConverterCard,
      source: 'core',
    },
    {
      id: 'image-upscaler',
      title: 'AI Image Upscaler',
      tagline: 'Real-ESRGAN · up to 4×',
      description:
        'Rebuild detail and boost resolution up to 4× on stills (JPG/PNG/WebP) using your local GPU, via realesrgan-ncnn-vulkan.',
      scope: 'desktop-exclusive',
      icon: '⇧',
      enabled: true,
      render: ImageUpscalerCard,
      source: 'core',
    },
    {
      id: 'video-upscaler',
      title: 'AI Video Upscaler',
      tagline: 'Real-ESRGAN · up to 4×',
      description:
        'Rebuild detail and boost resolution on video, frame by frame — extracts every frame, AI-upscales each one, then reassembles with the original audio. Genuinely slow for long clips; that cost is per-frame, not shortcuttable.',
      scope: 'desktop-exclusive',
      icon: '⇧',
      enabled: true,
      render: VideoUpscalerCard,
      source: 'core',
    },
    {
      id: 'frame-interpolation',
      title: 'Frame Interpolation',
      tagline: 'RIFE · smoother motion',
      description:
        'Generates real in-between frames to raise a video’s frame rate 2× or 4× — extracts every frame, AI-interpolates the gaps, then reassembles at the higher rate with the original audio. Same per-frame cost as the upscalers; not shortcuttable.',
      scope: 'desktop-exclusive',
      icon: '⏩',
      enabled: true,
      render: InterpolationCard,
      source: 'core',
    },
  ])
}